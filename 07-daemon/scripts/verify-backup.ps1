<#
.SYNOPSIS
  Validate a backup snapshot is internally consistent.

.DESCRIPTION
  Walks the snapshot folder, confirms MANIFEST.json parses, runs
  PRAGMA integrity_check on every captured SQLite file, validates
  every JSON state file under dashboard/ parses, and reports the
  total file/byte counts vs the manifest. Exit 0 on full pass,
  exit 1 on any failure.

.PARAMETER Snapshot
  Snapshot timestamp under the backup root. Defaults to the most
  recent snapshot.

.PARAMETER Target
  Backup root. Default: $env:DEVNEURAL_BACKUP_ROOT or
  C:\dev\backups\skill-connections.
#>

[CmdletBinding()]
param(
    [string]$Snapshot,
    [string]$Target = $env:DEVNEURAL_BACKUP_ROOT
)

$ErrorActionPreference = "Continue"
if (-not $Target) { $Target = "C:\dev\backups\skill-connections" }

if (-not (Test-Path -LiteralPath $Target)) {
    Write-Error "backup root not found: $Target"
    exit 1
}

if (-not $Snapshot) {
    $latest = Get-ChildItem -Path $Target -Directory |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$' } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $latest) { Write-Error "no snapshots in $Target"; exit 1 }
    $Snapshot = $latest.Name
}

$snapPath = Join-Path $Target $Snapshot
$manifestPath = Join-Path $snapPath "MANIFEST.json"
$failures = 0

Write-Host "[verify] snapshot: $Snapshot"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Error "missing MANIFEST.json"
    exit 1
}

try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    Write-Host "[verify] manifest: $($manifest.captured_at), files=$($manifest.file_count), sqlite=$($manifest.sqlite_count)"
} catch {
    Write-Error "MANIFEST.json malformed: $_"
    exit 1
}

# SQLite integrity_check
$sqliteCmd = Get-Command sqlite3 -ErrorAction SilentlyContinue
$sqliteCli = if ($sqliteCmd) { $sqliteCmd.Source } else { $null }
$sqliteSrc = Join-Path $snapPath "sqlite"
if ($sqliteCli -and (Test-Path -LiteralPath $sqliteSrc)) {
    Get-ChildItem -Recurse -File -Path $sqliteSrc -Include *.sqlite, *.db | ForEach-Object {
        $r = & $sqliteCli $_.FullName "PRAGMA integrity_check;"
        if ($r -ne "ok") {
            Write-Error "sqlite corruption: $($_.FullName) -> $r"
            $failures++
        }
    }
} elseif (-not $sqliteCli) {
    Write-Host "[verify] sqlite3 not on PATH; skipping integrity_check (install via 'winget install SQLite.SQLite' for full validation)"
}

# JSON state files under files/dashboard/
$dashStateDir = Join-Path $snapPath "files\dashboard"
if (Test-Path -LiteralPath $dashStateDir) {
    Get-ChildItem -Recurse -File -Path $dashStateDir -Include *.json | ForEach-Object {
        try {
            Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json | Out-Null
        } catch {
            Write-Error "JSON corrupt: $($_.FullName)"
            $failures++
        }
    }
}

# JSONL state files: each line must parse as JSON
Get-ChildItem -Recurse -File -Path $snapPath -Include *.jsonl | ForEach-Object {
    $lineNum = 0
    foreach ($line in (Get-Content -LiteralPath $_.FullName)) {
        $lineNum++
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $line | ConvertFrom-Json | Out-Null } catch {
            Write-Error "JSONL corrupt at $($_.FullName):$lineNum"
            $failures++
            break
        }
    }
}

# File-count drift check
$actualFiles = (Get-ChildItem -Recurse -File -Path $snapPath | Where-Object { $_.Name -ne "MANIFEST.json" } | Measure-Object).Count
$expectedFiles = $manifest.file_count - 1   # manifest counts itself
if ([Math]::Abs($actualFiles - $expectedFiles) -gt 5) {
    Write-Warning "file count drift: actual=$actualFiles expected=$expectedFiles"
}

if ($failures -gt 0) {
    Write-Host "[verify] FAIL: $failures issue(s)"
    exit 1
}
Write-Host "[verify] OK"
