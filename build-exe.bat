@echo off
cd /d "%~dp0"
title Building FluentCraft Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 goto fail

echo [2/2] Building installer and portable exe...
call npm run dist
if errorlevel 1 goto fail

echo.
echo Done! Files are in the dist folder.
start "" "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo Build failed.
echo If you see "Cannot create symbolic link": run this file as Administrator
echo OR enable Developer Mode (Windows Settings - For developers), then try again.
pause
exit /b 1
