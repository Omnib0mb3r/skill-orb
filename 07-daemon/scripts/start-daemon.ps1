<#
.SYNOPSIS
  Start the DevNeural daemon detached.

.DESCRIPTION
  Used by the autostart Task Scheduler entry so the dashboard is
  reachable from the phone without the user having to open VS Code
  or any specific app on OTLCDEV. Idempotent: the daemon's own
  PID-file check exits cleanly if another instance is already alive,
  so re-running this script after a crash or manual start is safe.

  Captures stdout/stderr to %DEVNEURAL_DATA_ROOT%\daemon.log so a
  failed launch is debuggable in the dashboard's log tail.

.PARAMETER DaemonRoot
  Path to the 07-daemon directory. Auto-detected from $PSScriptRoot.

.EXAMPLE
  pwsh -File start-daemon.ps1
#>

[CmdletBinding()]
param(
    [string]$DaemonRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$dist = Join-Path $DaemonRoot 'dist\daemon.js'
if (-not (Test-Path -LiteralPath $dist)) {
    throw "daemon.js not found at $dist. Run 'npm run build' in 07-daemon first."
}

# Cheap health probe before spawning. The autostart task fires every
# 5 minutes as a safety net; if the daemon is already alive on
# localhost:3747 we exit silently to avoid burning CPU on a no-op
# Node startup. Daemon's own PID-file singleton check is the
# authoritative guard, but skipping the spawn entirely is friendlier.
$port = if ($env:DEVNEURAL_PORT) { [int]$env:DEVNEURAL_PORT } else { 3747 }
try {
    $existing = Invoke-WebRequest -Uri "http://localhost:$port/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($existing.StatusCode -eq 200) {
        Write-Host "[start-daemon] already alive on :$port; skipping spawn"
        return
    }
} catch {
    # Not reachable; proceed with launch.
}

$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $node) {
    throw "node not on PATH. Install Node.js or set explicit path."
}

# Use the data root the daemon is configured for (matches DATA_ROOT default
# in 07-daemon/src/paths.ts). DEVNEURAL_DATA_ROOT env override respected.
$dataRoot = if ($env:DEVNEURAL_DATA_ROOT) { $env:DEVNEURAL_DATA_ROOT } else { 'C:\dev\data\skill-connections' }
if (-not (Test-Path -LiteralPath $dataRoot)) {
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
}
$logFile = Join-Path $dataRoot 'daemon.log'

# Detached child process so the scheduled task can exit immediately
# while the daemon keeps running. WindowStyle Hidden + windowsHide on
# child_process keeps the console flash off the desktop (Anti-slop #26).
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = "`"$dist`""
$psi.WorkingDirectory = $DaemonRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$proc = [System.Diagnostics.Process]::Start($psi)

# Bridge stdout + stderr to the daemon log so a failed start surfaces
# in the dashboard's log tail. Async so this script can exit.
$writer = [System.IO.StreamWriter]::new($logFile, $true)
$writer.AutoFlush = $true
$proc.OutputDataReceived += { if ($EventArgs.Data) { $writer.WriteLine($EventArgs.Data) } }
$proc.ErrorDataReceived  += { if ($EventArgs.Data) { $writer.WriteLine($EventArgs.Data) } }
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

Write-Host "[start-daemon] launched node $dist (pid=$($proc.Id))"
