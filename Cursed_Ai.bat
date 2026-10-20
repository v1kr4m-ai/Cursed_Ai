@echo off
rem Cursed_Ai - starts the local server with no console window and opens the app in its own window.
rem Closing the app window stops the server. Messages go to app.log.
if /i "%~1"=="run" goto run

rem First pass: relaunch this file hidden, then close this console straight away.
set "CURSED_BAT=%~f0"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath $env:ComSpec -ArgumentList ('/c ' + [char]34 + [char]34 + $env:CURSED_BAT + [char]34 + ' run' + [char]34)"
exit /b

:run
cd /d "%~dp0"
set "CURSED_APP=1"
set "LOG=%~dp0app.log"
echo [%date% %time%] Cursed_Ai starting > "%LOG%"

if not exist node_modules call npm install >> "%LOG%" 2>&1

rem Free port 3000 if an old server is still running there.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

start "" /b cmd /c "npm run dev >> "%LOG%" 2>&1"

rem Wait (up to 4 minutes) until the server answers.
set /a tries=0
:wait
curl -s -o nul http://localhost:3000/api/health
if not errorlevel 1 goto up
set /a tries+=1
if %tries% GEQ 240 goto fail
ping -n 2 127.0.0.1 >nul
goto wait

:up
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
start "" http://localhost:3000
exit /b

:edge
start "" "%EDGE%" --app=http://localhost:3000 --window-size=1500,950
exit /b

:chrome
start "" "%CHROME%" --app=http://localhost:3000 --window-size=1500,950
exit /b

:fail
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('Cursed_Ai did not start. See app.log in the app folder for the reason.', 'Cursed_Ai')"
exit /b 1
