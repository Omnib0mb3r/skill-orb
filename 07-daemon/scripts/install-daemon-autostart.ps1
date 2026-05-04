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

# At-logon trigger so the daemon comes up before the user opens any
# specific app. Adds a 30s delay so we don't race networking + login
# session warmup; daemon listens on 0.0.0.0 anyway, Tailscale picks
# it up as soon as it's bound.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User (whoami)
$trigger.Delay = 'PT30S'

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
        -Description 'DevNeural daemon autostart. Launches node dist/daemon.js at logon so the dashboard is reachable from the phone without opening any specific app.' `
        -Action $action `
        -Trigger $trigger `
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
