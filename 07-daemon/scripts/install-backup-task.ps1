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
    "-WindowStyle", "Hidden",
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

# Run as the current user at default privilege level. We don't need admin:
# the data root and the backup target are both user-readable. Requiring
# admin to install the task means non-elevated PowerShell can't register
# it, which is needlessly hostile for a single-user box.
$principal = New-ScheduledTaskPrincipal `
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Limited

# Replace any prior copy of this task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Description "DevNeural data root backup. Runs backup.ps1 daily and rotates snapshots." `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -ErrorAction Stop | Out-Null
} catch {
    if ($_.Exception.Message -match "Access is denied") {
        Write-Host ""
        Write-Host "[install-backup-task] PowerShell cmdlet access denied; falling back to schtasks.exe"
        $schtasksPath = "$env:WINDIR\System32\schtasks.exe"
        $taskCmd = "$pwsh $args"
        $startTime = $Time
        # /SC DAILY /ST <HH:mm> /TN <name> /TR <cmd>
        & $schtasksPath /Create /F /SC DAILY /ST $startTime /TN $taskName /TR "`"$taskCmd`""
        if ($LASTEXITCODE -ne 0) {
            throw "both Register-ScheduledTask and schtasks.exe failed"
        }
    } else {
        throw
    }
}

Write-Host "[install-backup-task] registered '$taskName' to run daily at $Time"
Write-Host "[install-backup-task] command: $pwsh $args"
Write-Host "[install-backup-task] trigger now: Start-ScheduledTask -TaskName $taskName"
Write-Host "[install-backup-task] view in UI: taskschd.msc -> Task Scheduler Library -> $taskName"
