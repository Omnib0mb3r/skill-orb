<#
.SYNOPSIS
  Remove duplicate hook entries from ~/.claude/settings.json.

.DESCRIPTION
  Walks every event in the hooks block and drops any group whose hooks
  match a previously seen (matcher, command) pair within the same event.
  DevNeural-owned entries are preserved untouched (they're idempotently
  re-installed by install-hooks.js anyway). Non-DevNeural duplicates
  arise mostly from running another tool's installer twice.

  Backs up settings.json to ~/.claude/settings.json.dedupe.bak.<timestamp>
  before any change. Refuses to run if the parsed JSON looks malformed.

.PARAMETER DryRun
  Print what would be removed without writing.

.EXAMPLE
  pwsh -File dedupe-hooks.ps1 -DryRun
  pwsh -File dedupe-hooks.ps1
#>

[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "settings.json not found at $settingsPath"
}

$raw = Get-Content -LiteralPath $settingsPath -Raw
try { $settings = $raw | ConvertFrom-Json } catch {
    throw "settings.json is not valid JSON: $_"
}
if (-not $settings.hooks) {
    Write-Host "[dedupe] no hooks block; nothing to do"
    exit 0
}

$totalRemoved = 0

# Helper: stringify a hooks group's signature for comparison.
function Get-Signature($group) {
    $parts = @()
    if ($group.matcher) { $parts += "m:$($group.matcher)" }
    foreach ($h in $group.hooks) {
        $parts += "c:$($h.command)|t:$($h.timeout)"
    }
    return ($parts -join "||")
}

foreach ($evt in $settings.hooks.PSObject.Properties.Name) {
    $groups = @($settings.hooks.$evt)
    if ($groups.Count -le 1) { continue }
    $seen = @{}
    $kept = @()
    foreach ($g in $groups) {
        $sig = Get-Signature $g
        if ($seen.ContainsKey($sig)) {
            $cmd = if ($g.hooks -and $g.hooks.Count -gt 0) { $g.hooks[0].command } else { "(empty)" }
            $short = if ($cmd.Length -gt 70) { $cmd.Substring(0, 70) + "..." } else { $cmd }
            Write-Host "[dedupe] ${evt}: dropping duplicate -> $short"
            $totalRemoved++
        } else {
            $seen[$sig] = $true
            $kept += $g
        }
    }
    $settings.hooks.$evt = $kept
}

Write-Host "[dedupe] $totalRemoved duplicate group(s) removed"
if ($DryRun) {
    Write-Host "[dedupe] dry run; no file written"
    exit 0
}
if ($totalRemoved -eq 0) {
    Write-Host "[dedupe] no changes"
    exit 0
}

$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$backup = "$settingsPath.dedupe.bak.$ts"
Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
Write-Host "[dedupe] backed up to $backup"

$settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
Write-Host "[dedupe] wrote $settingsPath"
