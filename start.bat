@echo off
title Cursed_Ai
cd /d "%~dp0"
if not exist node_modules call npm install

rem Free port 3000 if an old server is still running there
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

rem Open the browser a few seconds after the server starts
start "" /b cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
