<#
.SYNOPSIS
  Convert silent-shim inner-arg escaping from cmd-style "" to backslash \"
  so the wrap survives bash invocation.

.DESCRIPTION
  Claude Code on this host invokes hooks via bash (Git Bash). Bash does
  NOT treat "" as a literal quote inside a "..." string -- it sees it as
  empty-string concatenation and joins everything into a single token.
  The result: silent-shim receives one big space-joined argv[0] like
  C:\Program Files\Git\usr\bin\bash.exe ... -> silent-shim splits on the
  first space and tries to launch C:\Program, which fails.

  Backslash-escaped \" works in BOTH bash (literal quote inside dq) and
  Windows CRT parsing (CommandLineToArgvW). This script rewrites every
  hook entry of the form

    "<shim>" "<INNER-with-""-escapes>"

  to

    "<shim>" "<INNER-with-\"-escapes>"

  Single-arg invocations with no quotes inside (e.g. "node script.mjs")
  pass through unchanged.
#>

[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (-not (Test-Path -LiteralPath $settingsPath)) { throw "settings.json not found" }

$shimDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$shimCandidates = @(
    $env:DEVNEURAL_SILENT_SHIM,
    (Join-Path $shimDir 'silent-shim\bin\silent-shim.exe')
) | Where-Object { $_ }
$shimPath = $null
foreach ($c in $shimCandidates) {
    if (Test-Path -LiteralPath $c) { $shimPath = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $shimPath) { throw "silent-shim.exe not found" }

$rawBytes = [System.IO.File]::ReadAllBytes($settingsPath)
if ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes, 3, $rawBytes.Length - 3)
} else {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes)
}
$settings = $raw | ConvertFrom-Json
if (-not $settings.hooks) { Write-Host "[reesc] no hooks block"; exit 0 }

$shimEsc = [regex]::Escape($shimPath)
$wrapRe  = '^"' + $shimEsc + '"\s+"(.*)"$'

$rewritten = 0
$untouched = 0
foreach ($evt in $settings.hooks.PSObject.Properties.Name) {
    foreach ($g in @($settings.hooks.$evt)) {
        if (-not $g.hooks) { continue }
        for ($i = 0; $i -lt $g.hooks.Count; $i++) {
            $h = $g.hooks[$i]
            if ($h.type -ne 'command') { continue }
            $cmd = $h.command
            if ($cmd -notmatch $wrapRe) { $untouched++; continue }
            $encoded = $matches[1]
            if ($encoded -notmatch '""') { $untouched++; continue }
            # Decode "" -> ", then re-encode each " as \"
            $decoded = $encoded -replace '""', '"'
            $reencoded = $decoded -replace '"', '\"'
            $newCmd = '"' + $shimPath + '" "' + $reencoded + '"'
            if ($newCmd -eq $cmd) { $untouched++; continue }
            Write-Host "[reesc] $evt"
            Write-Host "       BEFORE: $cmd"
            Write-Host "       AFTER : $newCmd"
            if (-not $DryRun) { $h.command = $newCmd }
            $rewritten++
        }
    }
}

Write-Host ""
Write-Host "[reesc] rewritten $rewritten, untouched $untouched"
if ($DryRun) { Write-Host "[reesc] dry run; no file written"; exit 0 }
if ($rewritten -eq 0) { Write-Host "[reesc] no changes"; exit 0 }

$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
Copy-Item -LiteralPath $settingsPath -Destination "$settingsPath.reesc.bak.$ts" -Force
Write-Host "[reesc] backed up to $settingsPath.reesc.bak.$ts"
$json = $settings | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[reesc] wrote $settingsPath"
