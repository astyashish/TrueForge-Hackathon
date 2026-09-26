@echo off
setlocal EnableExtensions
title Threshold
cd /d "%~dp0"

echo ============================================================
echo  Threshold - Where agents work, and you decide where it stops
echo ============================================================
echo.

:: --- 1. Node.js 22.14+ ------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js is not installed. Install Node.js 22.14 or newer from https://nodejs.org
  goto :fail
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=14)?0:1)"
if errorlevel 1 (
  echo [x] Node.js 22.14+ is required. You have:
  node --version
  goto :fail
)

:: --- 2. Environment file -----------------------------------------------------
if not exist ".env.local" (
  if exist ".env.example" copy /y ".env.example" ".env.local" >nul
  echo [!] Created .env.local from .env.example.
  echo     Fill in GEMINI_API_KEY, SARVAM_API_KEY and the Supabase values, then run start.bat again.
  start "" notepad ".env.local"
  goto :fail
)

:: --- 3. Dependencies ---------------------------------------------------------
if not exist "node_modules\.bin\next.cmd" goto :install
if not exist "node_modules\.bin\trueforge.cmd" goto :install
if not exist "node_modules\@truefoundry\trueforge-sdk" goto :install
goto :deps_ok
:install
echo [1/4] Installing dependencies (first run only)...
call npm install
if errorlevel 1 (
  echo [x] npm install failed - see the errors above.
  goto :fail
)
:deps_ok
echo [1/4] Dependencies OK

:: --- 4. Backing services ------------------------------------------------------
::   TrueForge agent harness   http://localhost:8790
::   ops MCP servers           http://localhost:8791  (git / deploy / server)
::   demo-app (production)     http://localhost:4100
set TF_UP=1
set OPS_UP=1
curl -s -o nul -m 2 http://localhost:8790/api/v1/models
if errorlevel 1 set TF_UP=0
curl -s -o nul -m 2 http://localhost:8791/health
if errorlevel 1 set OPS_UP=0

if "%TF_UP%%OPS_UP%"=="00" (
  echo [2/4] Starting TrueForge + ops MCP servers in a new window...
  start "Threshold services" cmd /k npm run services
) else if "%OPS_UP%"=="0" (
  echo [2/4] TrueForge already running; starting the ops MCP servers in a new window...
  echo       If agents can't reach them, close the old TrueForge window and run start.bat again.
  start "Threshold ops MCP" cmd /k node scripts\ops-mcp.mjs
) else (
  echo [2/4] Services already running.
)

:: Registers Gemini + the ops MCP servers in TrueForge (idempotent).
echo [3/4] Configuring TrueForge...
call node scripts\trueforge-setup.mjs
if errorlevel 1 (
  echo [!] TrueForge setup did not finish - agents will fall back to static dialogue.
  echo     Check the "TrueForge Agent Harness" window for errors.
)

:: --- 5. Threshold game (port 3000) -------------------------------------------
curl -s -o nul -m 2 http://localhost:3000/
if not errorlevel 1 (
  echo [!] Something is already running on http://localhost:3000.
  echo     If it is an old Threshold dev server, close it and run start.bat again.
  start "" http://localhost:3000
  goto :done
)

echo [4/4] Starting the Threshold game on http://localhost:3000 ...
echo       The browser opens once the server is ready. Press Ctrl+C here to stop.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:3000/ | Out-Null; Start-Process 'http://localhost:3000'; break}catch{Start-Sleep -Seconds 2}}"
call npm run dev
goto :done

:fail
echo.
pause
exit /b 1

:done
endlocal
