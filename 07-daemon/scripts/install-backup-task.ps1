<#
.SYNOPSIS
  Register a Windows Task Scheduler entry that runs backup.ps1 daily.

.DESCRIPTION
  Creates a scheduled task named "DevNeural-Backup" that runs every
  day at the specified time. The task runs as the current user with
  the highest available privileges so robocopy can read every file
  in the data root regardless of Windows ACLs.

  Idempotent: re-running replaces the existing task with the new
  parameters.

.PARAMETER Time
  HH:mm 24-hour. Default 03:00.

.PARAMETER BackupRoot
  Where snapshots land. Default: C:\dev\backups\skill-connections.

.PARAMETER DataRoot
  Source. Default: C:\dev\data\skill-connections.

.PARAMETER Keep
  Snapshot retention count. Default 14.

.EXAMPLE
  pwsh -File install-backup-task.ps1
  pwsh -File install-backup-task.ps1 -Time 04:30 -Keep 30 -BackupRoot D:\backups
#>

[CmdletBinding()]
param(
    [string]$Time = "03:00",
    [string]$BackupRoot = "C:\dev\backups\skill-connections",
    [string]$DataRoot = "C:\dev\data\skill-connections",
    [int]$Keep = 14
)

$ErrorActionPreference = "Stop"

$taskName = "DevNeural-Backup"
$scriptPath = Join-Path $PSScriptRoot "backup.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "backup.ps1 not found at $scriptPath"
}

# Build the action: pwsh.exe -NoProfile -File backup.ps1 -Target ... etc.
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $pwshCmd) { $pwshCmd = Get-Command powershell -ErrorAction SilentlyContinue }
if (-not $pwshCmd) { throw "no PowerShell on PATH" }
$pwsh = $pwshCmd.Source

$args = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"",
    "-Target", "`"$BackupRoot`"",
    "-Source", "`"$DataRoot`"",
    "-Keep", $Keep
) -join " "

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $args

# Daily at the specified time
$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Run as the current interactive user with highest privileges
$principal = New-ScheduledTaskPrincipal `
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Highest

# Replace any prior copy of this task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Description "DevNeural data root backup. Runs backup.ps1 daily and rotates snapshots." `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

Write-Host "[install-backup-task] registered '$taskName' to run daily at $Time"
Write-Host "[install-backup-task] command: $pwsh $args"
Write-Host "[install-backup-task] trigger now: Start-ScheduledTask -TaskName $taskName"
Write-Host "[install-backup-task] view in UI: taskschd.msc → Task Scheduler Library → $taskName"
