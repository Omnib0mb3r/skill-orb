@echo off
title DevNeural Launcher
echo.
echo  DevNeural - Clearing ports and starting services...
echo.

REM ── Kill anything already on port 3747 (API) ──────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3747 "') do (
    taskkill /f /pid %%a >nul 2>&1
)

REM ── Kill anything already on port 5173 (Vite) ─────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 "') do (
    taskkill /f /pid %%a >nul 2>&1
)

REM ── Brief pause so ports are fully released ────────────────────────────────
timeout /t 1 /nobreak >nul

REM ── API Server (port 3747) ─────────────────────────────────────────────────
start "DevNeural API :3747" cmd /k "set DEVNEURAL_LOCAL_REPOS_ROOT=c:\dev\Projects&& cd /d c:\dev\Projects\DevNeural\02-api-server && npm run dev"

REM ── Web App (port 5173, strict — fails loudly if port is still taken) ──────
start "DevNeural Web :5173" cmd /k "cd /d c:\dev\Projects\DevNeural\03-web-app && npm run dev -- --port 5173 --strictPort"

REM ── Wait for Vite to be ready, then open browser ───────────────────────────
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo  Services started:
echo    API server  ^>  http://localhost:3747
echo    Web app     ^>  http://localhost:5173
echo.
echo  Close the two terminal windows to stop everything.
echo.
