<#
.SYNOPSIS
  Register a logon-triggered Task Scheduler entry that auto-starts
  the DevNeural daemon.

.DESCRIPTION
  Without this, rebooting OTLCDEV without opening VS Code leaves the
  daemon offline; the dashboard at https://otlcdev.tail27b46b.ts.net
  stops responding from the phone. After install, every logon kicks
  start-daemon.ps1 which spawns node dist/daemon.js detached.

  Idempotent: re-running replaces the existing task. Disable with
  -Disable. Trigger now with Start-ScheduledTask -TaskName
  "DevNeural-Daemon".

.PARAMETER Disable
  Unregister the task instead of installing.

.EXAMPLE
  pwsh -File install-daemon-autostart.ps1
  pwsh -File install-daemon-autostart.ps1 -Disable
#>

[CmdletBinding()]
param(
    [switch]$Disable
)

$ErrorActionPreference = 'Stop'

$taskName = 'DevNeural-Daemon'

if ($Disable) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[install-daemon-autostart] removed task '$taskName'"
    return
}

$scriptPath = Join-Path $PSScriptRoot 'start-daemon.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "start-daemon.ps1 not found at $scriptPath"
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
    '-File', "`"$scriptPath`""
) -join ' '

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $argList

# Three triggers stacked for resilience:
#   AtLogOn   - covers fresh login + reboot
#   AtStartup - covers full system boot before any user logs in
#   Daily     - hourly repeating safety-net so a sleep/wake cycle, an
#               OOM kill, or a manual stop is auto-recovered within an
#               hour. start-daemon.ps1 is a no-op when the daemon is
#               already alive (PID file singleton check), so the cost
#               of re-firing is just a quick exit.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User (whoami)
$logonTrigger.Delay = 'PT30S'

$bootTrigger = New-ScheduledTaskTrigger -AtStartup
$bootTrigger.Delay = 'PT60S'

$now = Get-Date
$safetyTrigger = New-ScheduledTaskTrigger -Once -At $now -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([System.TimeSpan]::MaxValue)

$triggers = @($logonTrigger, $bootTrigger, $safetyTrigger)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit ([System.TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# User-level task so non-elevated PowerShell can install it. Daemon
# binds to user-level paths (~/.devneural*, %DATA_ROOT%) anyway.
$principal = New-ScheduledTaskPrincipal `
    -UserId (whoami) `
    -LogonType Interactive `
    -RunLevel Limited

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Description 'DevNeural daemon autostart + watchdog. Launches node dist/daemon.js at logon, at boot, and every 5 minutes as a safety net (no-op when daemon is already alive). Keeps the dashboard reachable from the phone after sleep/wake or unexpected stops.' `
        -Action $action `
        -Trigger $triggers `
        -Settings $settings `
        -Principal $principal `
        -ErrorAction Stop | Out-Null
} catch {
    if ($_.Exception.Message -match 'Access is denied') {
        Write-Host ''
        Write-Host '[install-daemon-autostart] PowerShell cmdlet access denied; falling back to schtasks.exe'
        $schtasksPath = "$env:WINDIR\System32\schtasks.exe"
        $taskCmd = "$pwsh $argList"
        & $schtasksPath /Create /F /SC ONLOGON /TN $taskName /TR "`"$taskCmd`""
        if ($LASTEXITCODE -ne 0) {
            throw 'both Register-ScheduledTask and schtasks.exe failed'
        }
    } else {
        throw
    }
}

Write-Host "[install-daemon-autostart] registered '$taskName' to run at logon"
Write-Host "[install-daemon-autostart] command: $pwsh $argList"
Write-Host "[install-daemon-autostart] trigger now: Start-ScheduledTask -TaskName $taskName"
Write-Host "[install-daemon-autostart] view in UI: taskschd.msc -> Task Scheduler Library -> $taskName"
Write-Host "[install-daemon-autostart] uninstall: pwsh -File install-daemon-autostart.ps1 -Disable"
