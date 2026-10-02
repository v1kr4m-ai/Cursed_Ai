@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:3000
call npm run dev
pause
