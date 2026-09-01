@echo off
setlocal
cd /d "%~dp0"
title Broadband Diagnostics

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  echo Download it from https://nodejs.org/
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo pnpm is not installed.
    echo Run: npm install --global pnpm
    pause
    exit /b 1
  )
  call corepack pnpm --version >nul 2>nul
  if errorlevel 1 (
    echo pnpm could not be started.
    echo Run: npm install --global pnpm
    pause
    exit /b 1
  )
  set "PNPM_CMD=corepack pnpm"
) else (
  set "PNPM_CMD=pnpm"
)

if not exist "node_modules" (
  echo Installing the Windows dependencies. This happens only once...
  call %PNPM_CMD% install
  if errorlevel 1 goto install_failed
)

echo.
echo Starting Broadband Diagnostics...
echo Open http://localhost:3000 in your browser.
echo Keep this window open while using the dashboard.
echo.
call %PNPM_CMD% run dev
goto finished

:install_failed
echo.
echo Dependency installation failed. Check that Node.js is installed, then try again.
pause

:finished
