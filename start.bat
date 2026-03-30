@echo off
title DevNeural Launcher
echo.
echo  DevNeural - Starting services...
echo.

REM ── API Server (port 3747) ─────────────────────────────────────────────────
start "DevNeural API :3747" cmd /k "cd /d c:\dev\tools\DevNeural\02-api-server && npm run dev"

REM ── Web App (port 5173) ────────────────────────────────────────────────────
start "DevNeural Web :5173" cmd /k "cd /d c:\dev\tools\DevNeural\03-web-app && npm run dev"

REM ── Wait for Vite to be ready, then open browser ───────────────────────────
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo  Services started:
echo    API server  ^>  http://localhost:3747
echo    Web app     ^>  http://localhost:5173
echo.
echo  Close the two terminal windows to stop everything.
echo.
