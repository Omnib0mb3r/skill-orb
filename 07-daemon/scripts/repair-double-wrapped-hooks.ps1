<#
.SYNOPSIS
  One-shot repair: peel one silent-shim wrap layer off any hook entry that
  was double-wrapped by an older silence-all-hooks.ps1 detection bug.

.DESCRIPTION
  silence-all-hooks.ps1 (pre-fix) had a detection regex that failed to
  recognise commands whose shim path was already quoted, so re-running it
  re-wrapped every entry. The result was

    "<shim>" """<shim>"" ""<inner>"""

  which ships through CommandLineToArgvW as a malformed second-shim
  invocation -> "cannot execute" PostToolUse failures.

  This script detects that pattern and peels exactly one wrap layer,
  returning entries to single-wrap form

    "<shim>" "<inner-with-doubled-quotes>"

  Single-wrapped entries are left alone. A backup is written before any
  edit. Use -DryRun to preview.
#>

[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "settings.json not found at $settingsPath"
}

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
    throw "silent-shim.exe not found. Build it or set DEVNEURAL_SILENT_SHIM."
}

$rawBytes = [System.IO.File]::ReadAllBytes($settingsPath)
if ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes, 3, $rawBytes.Length - 3)
} else {
    $raw = [System.Text.Encoding]::UTF8.GetString($rawBytes)
}
$settings = $raw | ConvertFrom-Json
if (-not $settings.hooks) {
    Write-Host "[peel] no hooks block; nothing to do"; exit 0
}

$shimEsc = [regex]::Escape($shimPath)
$outerWrapRe = '^"' + $shimEsc + '"\s+"(.*)"$'

$peeled = 0
$skipped = 0
foreach ($evt in $settings.hooks.PSObject.Properties.Name) {
    foreach ($g in @($settings.hooks.$evt)) {
        if (-not $g.hooks) { continue }
        for ($i = 0; $i -lt $g.hooks.Count; $i++) {
            $h = $g.hooks[$i]
            if ($h.type -ne 'command') { continue }
            $cmd = $h.command
            if ($cmd -notmatch $outerWrapRe) { $skipped++; continue }
            $encodedInner = $matches[1]
            # Decode cmd-style "" -> "
            $decoded = $encodedInner -replace '""', '"'
            # Was this a double-wrap? detect by inner starting with shim again
            if ($decoded -notmatch ('^"' + $shimEsc + '"\s+')) { $skipped++; continue }
            $shortBefore = if ($cmd.Length -gt 70) { $cmd.Substring(0,70) + '...' } else { $cmd }
            $shortAfter  = if ($decoded.Length -gt 70) { $decoded.Substring(0,70) + '...' } else { $decoded }
            Write-Host "[peel] ${evt}:"
            Write-Host "       BEFORE: $shortBefore"
            Write-Host "       AFTER : $shortAfter"
            if (-not $DryRun) { $h.command = $decoded }
            $peeled++
        }
    }
}

Write-Host ""
Write-Host "[peel] peeled $peeled, untouched $skipped"
if ($DryRun) { Write-Host "[peel] dry run; no file written"; exit 0 }
if ($peeled -eq 0) { Write-Host "[peel] no changes"; exit 0 }

$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$backup = "$settingsPath.peel.bak.$ts"
Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
Write-Host "[peel] backed up to $backup"

$json = $settings | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[peel] wrote $settingsPath"
