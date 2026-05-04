<#
.SYNOPSIS
  Show the current DevNeural-Backup scheduled task target.

.DESCRIPTION
  Reads the registered DevNeural-Backup task and parses its action arguments
  to surface the -Target (BackupRoot), -Source (DataRoot), and -Keep values.
  Plus reports last run time and last result code so you can sanity-check
  the cadence is healthy.
#>

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "DevNeural-Backup" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "[backup-where] DevNeural-Backup not registered."
    Write-Host "[backup-where] Install with: npm run install-backup-task"
    Write-Host "[backup-where] Override location: npm run install-backup-task -- -BackupRoot `"$env:USERPROFILE\OneDrive\devneural-backups`""
    exit 1
}

$action = $task.Actions | Select-Object -First 1
$args = $action.Arguments
$target = if ($args -match '-Target\s+"([^"]+)"') { $matches[1] } else { "(unknown)" }
$source = if ($args -match '-Source\s+"([^"]+)"') { $matches[1] } else { "(unknown)" }
$keep   = if ($args -match '-Keep\s+(\d+)')        { $matches[1] } else { "(unknown)" }

$trigger = $task.Triggers | Select-Object -First 1
$schedule = "$($trigger.Frequency) at $($trigger.StartBoundary -split 'T' | Select-Object -Last 1)"

$info = Get-ScheduledTaskInfo -TaskName "DevNeural-Backup"

Write-Host "[backup-where] task    : DevNeural-Backup"
Write-Host "[backup-where] state   : $($task.State)"
Write-Host "[backup-where] schedule: daily at $(($trigger.StartBoundary -split 'T')[1] -replace ':\d+$','')"
Write-Host "[backup-where] target  : $target"
Write-Host "[backup-where] source  : $source"
Write-Host "[backup-where] keep    : $keep snapshots"
Write-Host "[backup-where] last run: $($info.LastRunTime)"
Write-Host "[backup-where] last rc : $($info.LastTaskResult) (0 = ok)"
Write-Host ""

# Inventory current snapshots if the target is reachable
if (Test-Path -LiteralPath $target) {
    $snaps = @(Get-ChildItem -Path $target -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$' } |
        Sort-Object Name -Descending)
    if ($snaps.Count -gt 0) {
        $newest = $snaps[0]
        $oldest = $snaps[-1]
        $totalBytes = (Get-ChildItem -Recurse -File -Path $target -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum
        $totalMB = [Math]::Round(($totalBytes / 1MB), 1)
        Write-Host "[backup-where] $($snaps.Count) snapshot(s) on disk, $totalMB MB total"
        Write-Host "[backup-where]   newest: $($newest.Name)"
        Write-Host "[backup-where]   oldest: $($oldest.Name)"
    } else {
        Write-Host "[backup-where] no snapshots yet at $target"
    }
} else {
    Write-Host "[backup-where] WARNING: target path does not exist: $target"
}

Write-Host ""
Write-Host "[backup-where] To change the target:"
Write-Host "[backup-where]   npm run install-backup-task -- -BackupRoot `"<new-path>`""
Write-Host "[backup-where] Examples:"
Write-Host "[backup-where]   -BackupRoot `"$env:USERPROFILE\OneDrive\devneural-backups`""
Write-Host "[backup-where]   -BackupRoot `"D:\backups\devneural`""
Write-Host "[backup-where]   -BackupRoot `"\\nas\share\devneural-backups`""
