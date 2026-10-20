@echo off
rem Creates a parallel working copy (git worktree) for one area of Cursed_Ai.
rem   tools\new-area.bat <name> <port>        e.g.  tools\new-area.bat images 3001
setlocal
cd /d "%~dp0.."
set "NAME=%~1"
set "AREAPORT=%~2"
if "%NAME%"=="" goto usage
if "%AREAPORT%"=="" goto usage

set "MAIN=%CD%"
set "TARGET=%MAIN%\..\Cursed_Ai_wt\%NAME%"
if exist "%TARGET%" (
  echo The folder already exists: %TARGET%
  exit /b 1
)

echo Creating worktree "%NAME%" on branch area/%NAME% ...
git worktree add "%TARGET%" -b "area/%NAME%"
if errorlevel 1 (
  echo git worktree failed - see the message above.
  exit /b 1
)

rem node_modules is shared with the main folder through a junction (no second install).
if exist "%MAIN%\node_modules" mklink /J "%TARGET%\node_modules" "%MAIN%\node_modules" >nul

rem Settings (ComfyUI / model folders) are copied once; secrets (google.json, Gemini key in config.json is included - delete it there if you prefer).
if exist "%MAIN%\config.json" copy /Y "%MAIN%\config.json" "%TARGET%\config.json" >nul

> "%TARGET%\.port" echo %AREAPORT%

echo.
echo Done.
echo   Folder : %TARGET%
echo   Branch : area/%NAME%
echo   Port   : %AREAPORT%   ^(written to .port^)
echo.
echo Open Claude Code in that folder, then start the app there with Cursed_Ai.bat.
echo See docs\PARALLEL_WORK.md for the rules.
exit /b 0

:usage
echo Usage: tools\new-area.bat ^<name^> ^<port^>
echo Example: tools\new-area.bat images 3001
exit /b 1
