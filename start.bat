@echo off
:: Start TSight: installs what's needed, builds, and opens the browser.

cd /d "%~dp0"

echo.
echo   TSight
echo   Understand any TypeScript codebase in 30 seconds.
echo   No AI. No guessing. Just facts from your code.
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   Node.js is not installed. TSight needs Node.js 20 or newer.
    echo   Get it from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%i
if %NODE_MAJOR% LSS 20 (
    echo   TSight needs Node.js 20 or newer. You have:
    node -v
    pause
    exit /b 1
)

echo   [1/3] Installing dependencies (quick if nothing changed)...
call npm install --no-audit --no-fund --loglevel=error
if %ERRORLEVEL% NEQ 0 (
    echo   npm install failed. Check your connection.
    pause
    exit /b 1
)

echo   [2/3] Building...
call npm run build -w @tsight/core --silent
if %ERRORLEVEL% NEQ 0 goto buildfailed
call npm run build -w @tsight/api --silent
if %ERRORLEVEL% NEQ 0 goto buildfailed

echo   [3/3] Starting. The UI is at http://localhost:3000 (API on 3001).
echo.

start /B cmd /c "cd packages\api && npm start --silent"
start /B cmd /c "cd packages\web && npm run dev --silent"

timeout /t 5 /nobreak >nul
start http://localhost:3000

echo   TSight is running. Close this window to stop it.
pause >nul
exit /b 0

:buildfailed
echo   Build failed.
pause
exit /b 1
