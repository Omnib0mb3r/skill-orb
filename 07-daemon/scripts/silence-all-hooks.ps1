<#
.SYNOPSIS
  Wrap every hook entry in ~/.claude/settings.json so child processes run
  invisibly (no flashing console windows) and still pipe stdin through.

.DESCRIPTION
  Walks every hook event and rewrites each entry's command to run via
  silent-shim.exe. The shim is a tiny native console app that hides the
  child's window (CreateNoWindow=true) and pipes the parent's stdin to
  the child, which is what every Claude Code hook needs (the JSON
  payload arrives on stdin).

  Earlier iterations of this script tried wscript+VBS (silent but
  dropped stdin -> hooks no-op'd) and `cmd /c` (piped stdin but cmd
  echoed it as garbage in additional-context). silent-shim.exe avoids
  both pitfalls.

  Detects entries that are already wrapped via silent-shim and skips
  them. Existing wscript and cmd-based wraps are unwrapped first so
  they get re-wrapped with the working shim. .sh files get a bash.exe
  prefix automatically.

  Backs up settings.json to settings.json.silence.bak.<timestamp>
  before writing.

  Caveat: upstream installers (caveman, gsd, stream-deck, deep-project)
  may overwrite their entries on update; re-run this script if flashes
  reappear after a plugin update.

.PARAMETER DryRun
  Print what would change without writing.
#>

[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "settings.json not found at $settingsPath"
}

# Resolve the shim relative to this script's location so the wrapper
# survives the repo being cloned anywhere. Override with
# DEVNEURAL_SILENT_SHIM if you keep the binary somewhere else.
$shimDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$shimCandidates = @(
    $env:DEVNEURAL_SILENT_SHIM,
    (Join-Path $shimDir 'silent-shim\bin\silent-shim.exe'),
    (Join-Path $shimDir 'silent-shim\bin\Release\net8.0\win-x64\silent-shim.exe')
) | Where-Object { $_ }
$shimPath = $null
foreach ($c in $shimCandidates) {
    if (Test-Path -LiteralPath $c) { $shimPath = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $shimPath) {
    throw "silent-shim.exe not built. Run: dotnet publish -c Release -r win-x64 in 07-daemon/scripts/silent-shim, or set DEVNEURAL_SILENT_SHIM to its location."
}

# Tolerate BOM that PS5.1 may have written previously.
$rawBytes = [System.IO.File]::ReadAllBytes($settingsPath)
if ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes, 3, $rawBytes.Length - 3)
} else {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes)
}
try {
    $settings = $raw | ConvertFrom-Json
} catch {
    throw "settings.json is not valid JSON: $_"
}
if (-not $settings.hooks) {
    Write-Host "[silence] no hooks block; nothing to do"
    exit 0
}

# Find bash for .sh wrapping
$bashCmd = Get-Command bash.exe -ErrorAction SilentlyContinue
$bashExe = if ($bashCmd) { $bashCmd.Source } else { "C:\Program Files\Git\bin\bash.exe" }

function Strip-OldWrap {
    param([string]$cmd)
    # cmd /c wscript.exe "<vbs>" "<inner>"  ->  inner (with "" decoded)
    if ($cmd -match '^\s*cmd(\.exe)?\s+/c\s+wscript(\.exe)?\s+"[^"]+"\s+"(.*)"\s*$') {
        return ($matches[3] -replace '""', '"')
    }
    # wscript.exe "<vbs>" "<inner>"  ->  inner (with "" decoded)
    if ($cmd -match '^\s*wscript(\.exe)?\s+"[^"]+"\s+"(.*)"\s*$') {
        return ($matches[2] -replace '""', '"')
    }
    return $cmd
}

function Get-WrappedCommand {
    param([string]$original)

    # Already wrapped via silent-shim? leave alone.
    # Anchored to start; the previous regex omitted the `^"` and the `"`
    # that closes the shim path, so a quoted shim invocation never matched
    # and every re-run double-wrapped its inputs.
    if ($original -match ('^"' + [regex]::Escape($shimPath) + '"\s+"')) { return $original }
    # cmd /c start /min — pre-existing pattern from other tools, leave alone.
    if ($original -match '^\s*cmd(\.exe)?\s+/c\s+start\s+/min') { return $original }

    # Strip old wscript / cmd-/c-wscript wraps so we can re-wrap cleanly.
    $inner = Strip-OldWrap $original

    # .sh path? prefix with bash.
    if ($inner -match '^\s*"?([^"]+\.sh)"?(\s+(.*))?$') {
        $shPath = $matches[1]
        $shArgs = $matches[3]
        $built = "`"$bashExe`" `"$shPath`""
        if ($shArgs) { $built = "$built $shArgs" }
        $inner = $built
    }

    # silent-shim.exe takes the full inner command as a single arg.
    # Escape embedded double-quotes with backslash. cmd-style "" doubling
    # also works under cmd.exe and CommandLineToArgvW, but Claude Code on
    # Windows runs hook commands through bash (Git Bash), and bash treats
    # "" inside "..." as empty-string concatenation -- it joins the inner
    # tokens into one argv slot, after which silent-shim splits on the
    # first space and tries to launch a path fragment like 'C:\Program'.
    # Backslash \" is honored both by bash dq AND by the Windows CRT, so
    # it survives either invocation path.
    $escaped = $inner -replace '"', '\"'
    return "`"$shimPath`" `"$escaped`""
}

$totalWrapped = 0
$totalSkipped = 0
foreach ($evt in $settings.hooks.PSObject.Properties.Name) {
    $groups = @($settings.hooks.$evt)
    foreach ($g in $groups) {
        if (-not $g.hooks) { continue }
        for ($i = 0; $i -lt $g.hooks.Count; $i++) {
            $h = $g.hooks[$i]
            if ($h.type -ne "command") { continue }
            $orig = $h.command
            $wrapped = Get-WrappedCommand $orig
            if ($wrapped -eq $orig) {
                $totalSkipped++
                continue
            }
            $shortOrig = if ($orig.Length -gt 60) { $orig.Substring(0, 60) + "..." } else { $orig }
            Write-Host "[silence] ${evt}: $shortOrig"
            if (-not $DryRun) { $h.command = $wrapped }
            $totalWrapped++
        }
    }
}

Write-Host ""
Write-Host "[silence] wrapped $totalWrapped, already-silent $totalSkipped"

if ($DryRun) {
    Write-Host "[silence] dry run; no file written"
    exit 0
}
if ($totalWrapped -eq 0) {
    Write-Host "[silence] no changes needed"
    exit 0
}

# Backup before writing
$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$backup = "$settingsPath.silence.bak.$ts"
Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
Write-Host "[silence] backed up to $backup"

# Write back without BOM
$json = $settings | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[silence] wrote $settingsPath"
Write-Host ""
Write-Host "[silence] Note: re-run this script if a plugin update overwrites its hook entry."
