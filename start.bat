@echo off
title DevNeural Daemon

REM ==========================================================================
REM DevNeural launcher.
REM
REM The daemon lazy-starts on the first Claude Code hook event after install,
REM so this script is only needed if you want to start the daemon explicitly
REM (e.g. on first install, or for development).
REM
REM Usage:
REM   start.bat            launch daemon
REM   start.bat status     run npm run status and exit
REM   start.bat setup      run npm run setup (idempotent install)
REM   start.bat stop       stop the running daemon
REM ==========================================================================

setlocal

if /I "%~1"=="status" (
    pushd "%~dp007-daemon"
    call npm run status
    popd
    goto :end
)

if /I "%~1"=="setup" (
    pushd "%~dp007-daemon"
    call npm run setup
    popd
    goto :end
)

if /I "%~1"=="stop" (
    if exist "C:\dev\data\skill-connections\daemon.pid" (
        for /f %%p in ('type "C:\dev\data\skill-connections\daemon.pid"') do (
            taskkill /F /PID %%p >nul 2>&1
            echo Stopped daemon pid %%p
        )
    ) else (
        echo No daemon.pid found.
    )
    goto :end
)

REM Free port 3747 if anything is squatting it
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3747 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Start daemon
pushd "%~dp007-daemon"

if not exist "dist\daemon.js" (
    echo Daemon not built. Running npm install + build first...
    call npm install
    call npm run build
)

start "DevNeural Daemon :3747" cmd /k "node dist\daemon.js"

popd

timeout /t 2 /nobreak >nul
echo.
echo  DevNeural daemon launched on http://127.0.0.1:3747
echo.
echo  Useful commands:
echo    start.bat status   diagnostic
echo    start.bat setup    idempotent install
echo    start.bat stop     stop the daemon
echo.

:end
endlocal
