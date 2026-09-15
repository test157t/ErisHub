@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Building ErisHub...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo Starting ErisHub...
set "HOST=0.0.0.0"
set "PORT=8780"
echo Open http://localhost:%PORT% on this computer.
echo On another device, use this computer's LAN or Tailscale IP with port %PORT%.
echo Keep this window open while using ErisHub.
call npm start
set "ERISHUB_EXIT_CODE=%ERRORLEVEL%"
if not "%ERISHUB_EXIT_CODE%"=="0" echo ErisHub stopped with error %ERISHUB_EXIT_CODE%. See the error above.

pause
exit /b %ERISHUB_EXIT_CODE%
