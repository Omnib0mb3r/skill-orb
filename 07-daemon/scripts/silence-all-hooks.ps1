<#
.SYNOPSIS
  Wrap every hook entry in ~/.claude/settings.json so child processes run
  invisibly (no flashing console windows).

.DESCRIPTION
  Walks every hook event and wraps each entry's command in a WScript shim
  (wscript.exe + a generic VBS that takes the full command as one argument
  and runs it with WindowStyle = 0). Result: zero visible windows on
  Pre/Post tool use, prompt submit, session start/end, etc.

  Detects entries that are already wrapped (wscript or cmd /c start /min)
  and skips them. .sh files get a bash.exe prefix automatically.

  Backs up settings.json to settings.json.silence.bak.<timestamp> before
  changing anything.

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

# Generic shim path: one VBS that takes the full command as a single arg
# and runs it hidden. Lives next to DevNeural's other hook artifacts.
$shimPath = "C:\dev\Projects\DevNeural\07-daemon\dist\capture\hooks\silent-shim.vbs"
$shimDir = Split-Path -Parent $shimPath
if (-not (Test-Path -LiteralPath $shimDir)) {
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
}
$shimContent = @'
Option Explicit
Dim sh
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count > 0 Then
  sh.Run WScript.Arguments(0), 0, False
End If
Set sh = Nothing
'@
[System.IO.File]::WriteAllText($shimPath, $shimContent, [System.Text.UTF8Encoding]::new($false))

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

function Get-WrappedCommand {
    param([string]$original)

    # Already wrapped? skip.
    # Bare wscript.exe start fails on Claude Code's hook runner because
    # the runner invokes commands through a bash shell that treats the
    # .exe as a script source ("cannot execute binary file"). Prefix
    # with `cmd /c` so the first token is cmd.exe, which bash exec's
    # cleanly, and let cmd run wscript inside its own context.
    if ($original -match '^\s*cmd(\.exe)?\s+/c\s+wscript(\.exe)?\b') { return $original }
    if ($original -match '^\s*cmd(\.exe)?\s+/c\s+start\s+/min') { return $original }
    if ($original -match '^\s*wscript(\.exe)?\b') {
        # Previously-wrapped entries that lack the cmd /c prefix get
        # rewritten so they survive Claude Code's bash-based exec path.
        $rest = $original -replace '^\s*wscript(\.exe)?\s+', ''
        return "cmd /c wscript.exe $rest"
    }

    # .sh path? prefix with bash.
    $inner = $original
    if ($original -match '^\s*"?([^"]+\.sh)"?(\s+(.*))?$') {
        $shPath = $matches[1]
        $shArgs = $matches[3]
        $inner = "`"$bashExe`" `"$shPath`""
        if ($shArgs) { $inner = "$inner $shArgs" }
    }

    # Escape inner quotes for the wscript argument: each " becomes "" in the
    # wrapped command, and the whole thing is wrapped in outer quotes.
    $escaped = $inner -replace '"', '""'
    return "cmd /c wscript.exe `"$shimPath`" `"$escaped`""
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
