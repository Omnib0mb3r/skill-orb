<#
.SYNOPSIS
  Restore the DevNeural data root from a backup snapshot.

.DESCRIPTION
  Mirrors a snapshot back into the data root. Refuses to run while the
  daemon is up unless -Force is given (cold-restore is safer; the daemon
  caches state in memory and a hot restore can desync the in-process
  vector store from the on-disk file).

.PARAMETER Snapshot
  Snapshot folder name (the timestamp) under the backup root. If
  omitted, the most recent snapshot is used.

.PARAMETER Target
  Backup root. Default: $env:DEVNEURAL_BACKUP_ROOT or
  C:\dev\backups\skill-connections.

.PARAMETER DataRoot
  Where to restore into. Default: $env:DEVNEURAL_DATA_ROOT or
  C:\dev\data\skill-connections.

.PARAMETER DaemonUrl
  Liveness probe to abort if the daemon is up. Use "" to skip.

.PARAMETER Force
  Allow restore while daemon is up. Strongly discouraged.

.EXAMPLE
  pwsh -File restore.ps1
  pwsh -File restore.ps1 -Snapshot 2026-05-04T03-00-00
#>

[CmdletBinding()]
param(
    [string]$Snapshot,
    [string]$Target = $env:DEVNEURAL_BACKUP_ROOT,
    [string]$DataRoot = $env:DEVNEURAL_DATA_ROOT,
    [string]$DaemonUrl = "http://localhost:3747",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Target) { $Target = "C:\dev\backups\skill-connections" }
if (-not $DataRoot) { $DataRoot = "C:\dev\data\skill-connections" }

if (-not (Test-Path -LiteralPath $Target)) {
    throw "backup root not found: $Target"
}

if (-not $Snapshot) {
    $latest = Get-ChildItem -Path $Target -Directory |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$' } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $latest) { throw "no snapshots found in $Target" }
    $Snapshot = $latest.Name
}

$snapPath = Join-Path $Target $Snapshot
if (-not (Test-Path -LiteralPath $snapPath)) {
    throw "snapshot not found: $snapPath"
}
$manifestPath = Join-Path $snapPath "MANIFEST.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "snapshot is missing MANIFEST.json: $snapPath"
}

if ($DaemonUrl -and -not $Force) {
    $up = $false
    try {
        $r = Invoke-WebRequest -Uri "$DaemonUrl/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $up = $true }
    } catch {}
    if ($up) {
        throw "daemon is up at $DaemonUrl. Stop it (taskkill or close terminal) and re-run, or pass -Force."
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host "[restore] snapshot: $Snapshot"
Write-Host "[restore]   captured_at: $($manifest.captured_at)"
Write-Host "[restore]   files: $($manifest.file_count), sqlite: $($manifest.sqlite_count)"

$confirm = Read-Host "[restore] OVERWRITE $DataRoot from this snapshot? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "[restore] aborted"
    exit 0
}

# Sidekick backup of current data root before overwriting, in case the
# user changes their mind. Cheap insurance.
$preRestore = Join-Path $Target ("pre-restore-$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')")
Write-Host "[restore] saving current state to $preRestore"
New-Item -ItemType Directory -Path $preRestore -Force | Out-Null
& robocopy "$DataRoot" "$preRestore\files" /MIR /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "pre-restore safety copy failed; aborting"
}

# Mirror sqlite back first so the file replaces any open WAL state cleanly
$sqliteSrc = Join-Path $snapPath "sqlite"
if (Test-Path -LiteralPath $sqliteSrc) {
    Get-ChildItem -Recurse -File -Path $sqliteSrc | ForEach-Object {
        $rel = $_.FullName.Substring($sqliteSrc.Length).TrimStart('\', '/')
        $dest = Join-Path $DataRoot $rel
        $destDir = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
}

# Mirror the file tree back
$filesSrc = Join-Path $snapPath "files"
if (Test-Path -LiteralPath $filesSrc) {
    & robocopy "$filesSrc" "$DataRoot" /MIR /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy restore failed with exit $LASTEXITCODE"
    }
}

Write-Host "[restore] done. Pre-restore copy at $preRestore (delete manually when satisfied)."
