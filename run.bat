@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo    LuminaHDR - High Dynamic Range Photo Viewer
echo ====================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required to run LuminaHDR.
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] Installing lightweight dependencies...
    call npm install --omit=dev
)

if not exist "src\client\css\lumina-theme.css" (
    echo [INFO] Running initial LuminaSync...
    call npm run sync:lumina
)

set "TARGET_DIR=%~1"
if "%TARGET_DIR%"=="" set "TARGET_DIR=.\sample-photos"

echo [INFO] Starting LuminaHDR pointing to: %TARGET_DIR%
node src\server\app.js "%TARGET_DIR%" %*
pause
