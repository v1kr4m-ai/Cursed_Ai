@echo off
title Cursed_Ai setup
cd /d "%~dp0"
echo.
echo  Cursed_Ai - one-time setup
echo  ==========================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  Node.js was not found. Install the LTS version from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
set NODEMAJOR=%NODEMAJOR:v=%
if %NODEMAJOR% LSS 20 (
  echo  Node.js 20 or newer is required. You have:
  node -v
  echo  Update it from https://nodejs.org then run this file again.
  pause
  exit /b 1
)

echo  Installing dependencies (a few minutes the first time)...
call npm install
if errorlevel 1 (
  echo  npm install failed - see the messages above.
  pause
  exit /b 1
)

echo  Creating a desktop shortcut...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Cursed_Ai.lnk'); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.Description='Start Cursed_Ai'; $s.Save()"

echo.
echo  Done. Double-click "Cursed_Ai" on your desktop (or start.bat) to launch the app.
echo  Optional: copy .env.example to .env.local and add GEMINI_API_KEY for cloud image/video.
echo.
pause
