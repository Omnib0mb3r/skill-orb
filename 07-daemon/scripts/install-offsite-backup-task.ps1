<#
.SYNOPSIS
  Register a weekly Task Scheduler entry that snapshots the data
  root to a separate (e.g. external) target. Runs alongside the
  daily OneDrive task as a second copy in case OneDrive itself
  goes down.

.DESCRIPTION
  Same pattern as install-backup-task.ps1 but with:
    - WEEKLY trigger (default Sunday 04:30 by parameter)
    - Different default -BackupRoot (intended for an external drive)
    - Different task name "DevNeural-Backup-Offsite" so both tasks
      can coexist
    - Reuses backup.ps1 so retention + atomic rename + manifest
      are identical across both targets

  External drive must be present at the path when the task fires.
  If absent, the task fails and the next week tries again. There is
  no plug-and-play mount triggering: that's a posture decision the
  user makes by leaving the drive connected on the schedule.

.PARAMETER Day
  DayOfWeek string. Default Sunday.

.PARAMETER Time
  HH:mm 24-hour. Default 04:30.

.PARAMETER BackupRoot
  Where snapshots land. Default: D:\devneural-offsite (likely an
  external drive). Change to your real external drive letter.

.PARAMETER DataRoot
  Source. Default: C:\dev\data\skill-connections.

.PARAMETER Keep
  Snapshot retention count. Default 8 (~2 months of weeklies).

.PARAMETER Disable
  Unregister instead of installing.

.EXAMPLE
  pwsh -File install-offsite-backup-task.ps1 -BackupRoot E:\devneural-offsite
  pwsh -File install-offsite-backup-task.ps1 -Day Saturday -Time 23:00
  pwsh -File install-offsite-backup-task.ps1 -Disable
#>

[CmdletBinding()]
param(
    [ValidateSet('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')]
    [string]$Day = 'Sunday',
    [string]$Time = '04:30',
    [string]$BackupRoot = 'D:\devneural-offsite',
    [string]$DataRoot = 'C:\dev\data\skill-connections',
    [int]$Keep = 8,
    [switch]$Disable
)

$ErrorActionPreference = 'Stop'

$taskName = 'DevNeural-Backup-Offsite'

if ($Disable) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[install-offsite-backup-task] removed task '$taskName'"
    return
}

$scriptPath = Join-Path $PSScriptRoot 'backup.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "backup.ps1 not found at $scriptPath"
}

$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $pwshCmd) { $pwshCmd = Get-Command powershell -ErrorAction SilentlyContinue }
if (-not $pwshCmd) { throw 'no PowerShell on PATH' }
$pwsh = $pwshCmd.Source

$argList = @(
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$scriptPath`"",
    '-Target', "`"$BackupRoot`"",
    '-Source', "`"$DataRoot`"",
    '-Keep', $Keep
) -join ' '

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $argList

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4)

$principal = New-ScheduledTaskPrincipal `
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Limited

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Description "DevNeural off-site weekly backup. Runs backup.ps1 every $Day at $Time against an external/secondary target so OneDrive going down can't take all snapshots with it." `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -ErrorAction Stop | Out-Null
} catch {
    if ($_.Exception.Message -match 'Access is denied') {
        Write-Host ''
        Write-Host '[install-offsite-backup-task] PowerShell cmdlet access denied; falling back to schtasks.exe'
        $schtasksPath = "$env:WINDIR\System32\schtasks.exe"
        $taskCmd = "$pwsh $argList"
        $schDay = switch ($Day) {
            'Sunday' { 'SUN' }; 'Monday' { 'MON' }; 'Tuesday' { 'TUE' };
            'Wednesday' { 'WED' }; 'Thursday' { 'THU' }; 'Friday' { 'FRI' };
            'Saturday' { 'SAT' }
        }
        & $schtasksPath /Create /F /SC WEEKLY /D $schDay /ST $Time /TN $taskName /TR "`"$taskCmd`""
        if ($LASTEXITCODE -ne 0) {
            throw 'both Register-ScheduledTask and schtasks.exe failed'
        }
    } else {
        throw
    }
}

Write-Host "[install-offsite-backup-task] registered '$taskName' to run every $Day at $Time"
Write-Host "[install-offsite-backup-task] target: $BackupRoot (must be present at run time)"
Write-Host "[install-offsite-backup-task] keep:   $Keep snapshots"
Write-Host "[install-offsite-backup-task] command: $pwsh $argList"
Write-Host "[install-offsite-backup-task] trigger now: Start-ScheduledTask -TaskName $taskName"
Write-Host "[install-offsite-backup-task] uninstall: pwsh -File install-offsite-backup-task.ps1 -Disable"
