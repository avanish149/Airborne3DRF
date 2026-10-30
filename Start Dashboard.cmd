@echo off
cd /d "%~dp0dashboard"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local CSV logger.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4174"
node local-server.mjs
pause
