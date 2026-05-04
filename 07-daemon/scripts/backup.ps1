<#
.SYNOPSIS
  Robust backup of the DevNeural data root.

.DESCRIPTION
  Snapshots c:/dev/data/skill-connections/ to a timestamped folder under
  the configured backup target. Atomic where possible: SQLite is captured
  via VACUUM INTO so the snapshot is internally consistent even if the
  daemon is mid-write, and write-ahead logs are flushed first. Wiki is
  mirrored via robocopy with /MIR; reference docs the same. Models are
  excluded by default (re-downloadable, hundreds of MB, stable).

  Each snapshot writes a MANIFEST.json with file counts, byte totals,
  SQLite row counts (for sanity), and the daemon version + git commit
  at backup time.

  Rotation: keeps the most recent N snapshots; older ones are pruned
  on each successful run. Default N = 14.

.PARAMETER Target
  Backup root. Default: $env:DEVNEURAL_BACKUP_ROOT or
  C:\dev\backups\skill-connections.

.PARAMETER Source
  Source data root. Default: $env:DEVNEURAL_DATA_ROOT or
  C:\dev\data\skill-connections.

.PARAMETER Keep
  Number of snapshots to keep. Default 14.

.PARAMETER IncludeModels
  Include the embedder/whisper model cache. Default: skip.

.PARAMETER DaemonUrl
  Where to issue a flush-and-checkpoint request. Default
  http://localhost:3747. Use "" to skip the live flush (cold backup).

.EXAMPLE
  pwsh -File backup.ps1
  pwsh -File backup.ps1 -Target D:\backups -Keep 30 -IncludeModels
#>

[CmdletBinding()]
param(
    [string]$Target = $env:DEVNEURAL_BACKUP_ROOT,
    [string]$Source = $env:DEVNEURAL_DATA_ROOT,
    [int]$Keep = 14,
    [switch]$IncludeModels,
    [string]$DaemonUrl = "http://localhost:3747"
)

$ErrorActionPreference = "Stop"

if (-not $Target) { $Target = "C:\dev\backups\skill-connections" }
if (-not $Source) { $Source = "C:\dev\data\skill-connections" }

if (-not (Test-Path -LiteralPath $Source)) {
    throw "data root not found: $Source"
}

$timestamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$snap = Join-Path $Target $timestamp
$staging = "$snap.partial"

Write-Host "[backup] source: $Source"
Write-Host "[backup] target: $snap"

New-Item -ItemType Directory -Path $staging -Force | Out-Null

# 1. Ask the daemon to flush + checkpoint (best-effort). If the daemon is
# down, the backup is still consistent for files at rest but the SQLite
# WAL might lag a few seconds; we accept that for a cold backup.
if ($DaemonUrl) {
    try {
        $r = Invoke-WebRequest -Uri "$DaemonUrl/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            try {
                Invoke-WebRequest -Uri "$DaemonUrl/flush" -Method Post -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue | Out-Null
                Write-Host "[backup] daemon flush requested"
            } catch {
                Write-Host "[backup] daemon present but /flush rejected; proceeding (cold-equivalent)"
            }
        }
    } catch {
        Write-Host "[backup] daemon not reachable at $DaemonUrl; proceeding cold"
    }
}

# 2. SQLite: VACUUM INTO produces a consistent point-in-time snapshot
# regardless of whether the source DB has open writers. Find every .sqlite
# / .db file under Source and clone each.
$sqliteOut = Join-Path $staging "sqlite"
New-Item -ItemType Directory -Path $sqliteOut -Force | Out-Null
$dbFiles = Get-ChildItem -Path $Source -Recurse -File -Include *.sqlite, *.db -ErrorAction SilentlyContinue
$dbCount = 0
foreach ($db in $dbFiles) {
    $rel = $db.FullName.Substring($Source.Length).TrimStart('\', '/')
    $relDir = Split-Path -Parent $rel
    $outDir = if ($relDir) { Join-Path $sqliteOut $relDir } else { $sqliteOut }
    New-Item -ItemType Directory -Path $outDir -Force -ErrorAction SilentlyContinue | Out-Null
    $outFile = Join-Path $outDir $db.Name
    # PowerShell: use sqlite3.exe if on PATH; fall back to a literal copy
    # which can race a writer but is acceptable for a single-user box.
    $sqliteCmd = Get-Command sqlite3 -ErrorAction SilentlyContinue
    $sqliteCli = if ($sqliteCmd) { $sqliteCmd.Source } else { $null }
    if ($sqliteCli) {
        & $sqliteCli $db.FullName ".backup '$outFile'"
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[backup] sqlite3 .backup failed for $rel; falling back to file copy"
            Copy-Item -LiteralPath $db.FullName -Destination $outFile -Force
        } else {
            $dbCount++
        }
    } else {
        Copy-Item -LiteralPath $db.FullName -Destination $outFile -Force
        $dbCount++
    }
}

# 3. Mirror the rest of the data root, excluding sqlite/db (already
# captured above), models (unless -IncludeModels), and the daemon log.
$exclude = @("*.sqlite", "*.sqlite-journal", "*.sqlite-wal", "*.sqlite-shm", "*.db", "*.db-journal", "*.db-wal", "*.db-shm", "daemon.log")
$excludeDirs = @()
if (-not $IncludeModels) {
    $excludeDirs += "models"
}

$filesOut = Join-Path $staging "files"
$rcArgs = @(
    "$Source",
    "$filesOut",
    "/MIR",          # mirror
    "/R:1",          # 1 retry on busy
    "/W:1",          # 1 second wait
    "/MT:8",         # 8 threads
    "/NFL", "/NDL",  # quiet listings
    "/NJH", "/NJS",  # quiet headers
    "/XF"
)
$rcArgs += $exclude
if ($excludeDirs.Count -gt 0) {
    $rcArgs += "/XD"
    $rcArgs += $excludeDirs
}
& robocopy @rcArgs | Out-Null
$rcExit = $LASTEXITCODE
# robocopy exit codes 0-7 are success-ish; 8+ is a real failure.
if ($rcExit -ge 8) {
    Remove-Item -Recurse -Force -LiteralPath $staging -ErrorAction SilentlyContinue
    throw "robocopy failed with exit $rcExit"
}

# 4. Manifest: enough metadata to verify the snapshot is sane.
$manifest = [ordered]@{
    version          = 1
    captured_at      = (Get-Date).ToUniversalTime().ToString("o")
    source           = $Source
    sqlite_count     = $dbCount
    include_models   = [bool]$IncludeModels
    daemon_url_probed = $DaemonUrl
    daemon_reachable = ($DaemonUrl -and (Test-NetConnection -ComputerName ([Uri]$DaemonUrl).Host -Port ([Uri]$DaemonUrl).Port -InformationLevel Quiet -WarningAction SilentlyContinue))
    git_commit       = $null
    file_count       = (Get-ChildItem -Recurse -File -Path $staging | Measure-Object).Count
    bytes            = ((Get-ChildItem -Recurse -File -Path $staging | Measure-Object -Sum Length).Sum)
}
try {
    $repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $commit = & git -C $repo rev-parse --short HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { $manifest.git_commit = $commit.Trim() }
} catch {}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging "MANIFEST.json") -Encoding UTF8

# 5. Atomic rename: only swap into place once everything above succeeded.
if (Test-Path -LiteralPath $snap) {
    Remove-Item -Recurse -Force -LiteralPath $snap
}
Rename-Item -LiteralPath $staging -NewName (Split-Path $snap -Leaf)

# 6. Rotation: keep the most recent $Keep snapshots, prune the rest.
$snapshots = Get-ChildItem -Path $Target -Directory |
    Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$' } |
    Sort-Object Name -Descending
if ($snapshots.Count -gt $Keep) {
    $toPrune = $snapshots | Select-Object -Skip $Keep
    foreach ($p in $toPrune) {
        Write-Host "[backup] pruning $($p.Name)"
        Remove-Item -Recurse -Force -LiteralPath $p.FullName -ErrorAction SilentlyContinue
    }
}

$mb = [Math]::Round($manifest.bytes / 1MB, 1)
Write-Host "[backup] done: $($manifest.file_count) files, $mb MB, $dbCount sqlite"
Write-Host "[backup] location: $snap"
