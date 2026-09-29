@echo off
rem Spore Anthem Studio: first run extracts assets from your Spore install, then starts the app.
cd /d "%~dp0"
where python >nul 2>nul || (
  echo Python 3 is needed but wasn't found.
  echo Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then run this again.
  pause & exit /b 1
)
if not exist "app\data\patches.json" (
  echo First run: extracting music, sounds and artwork from your Spore install...
  python tools\setup.py || (pause & exit /b 1)
)
echo Spore Anthem Studio is running at http://127.0.0.1:8765/app/
echo Keep this window open while you use it. Close it to stop.
start "" http://127.0.0.1:8765/app/
python tools\serve.py 8765
