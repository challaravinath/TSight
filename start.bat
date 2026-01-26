@echo off
chcp 65001 >nul 2>nul
title TSight - TypeScript Code Analyzer

echo.
echo  ============================================================
echo.
echo    TSight - TypeScript Code Analyzer
echo.
echo    Understand any codebase in 30 seconds.
echo    No AI. No guessing. Just facts from your code.
echo.
echo  ============================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  TSight requires Node.js 18 or higher.
    echo.
    echo  Download from: https://nodejs.org/
    echo.
    echo  After installing, restart this script.
    echo.
    pause
    exit /b 1
)

:: Check Node version
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo  [1/4] Node.js detected: %NODE_VERSION%

:: Check if version is 18+
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if "%NODE_MAJOR%"=="" set NODE_MAJOR=0

echo.

:: Install dependencies if needed
if not exist "node_modules" (
    echo  [2/4] Installing dependencies... (first run, may take a minute)
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo  [ERROR] npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo        Done!
) else (
    echo  [2/4] Dependencies installed
)
echo.

:: Build if needed
if not exist "packages\core\dist" (
    echo  [3/4] Building core...
    call npm run build --workspace=@tsight/core
    if %ERRORLEVEL% NEQ 0 (
        echo  [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo        Done!
) else (
    echo  [3/4] Core ready
)

if not exist "packages\api\dist" (
    echo        Building API...
    call npm run build --workspace=@tsight/api
    if %ERRORLEVEL% NEQ 0 (
        echo  [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo        Done!
) else (
    echo        API ready
)
echo.

:: Start servers
echo  [4/4] Starting TSight...
echo.
echo  ------------------------------------------------------------
echo.
echo    API server:  http://localhost:3001
echo    Web UI:      http://localhost:3000
echo.
echo    Waiting for servers to start...
echo.
echo  ------------------------------------------------------------
echo.
echo    Press Ctrl+C to stop
echo.

:: Start API in background
start /B cmd /c "cd packages\api && npm start 2>nul"

:: Wait for API to start
timeout /t 3 /nobreak >nul

:: Start Web UI in background
cd packages\web
start /B cmd /c "npm run dev 2>nul"

:: Wait for Vite to be ready (it takes a few seconds)
echo.
echo  Waiting for Vite dev server...
timeout /t 5 /nobreak >nul

:: Now open browser
echo  Opening browser...
start http://localhost:3000

:: Keep window open
echo.
echo  TSight is running. Press any key to stop...
pause >nul
