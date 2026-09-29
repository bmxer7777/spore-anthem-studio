@echo off
rem Spore Anthem Studio: first run extracts assets from your Spore install, then starts the app.
cd /d "%~dp0"
if not exist "app\data\patches.json" (
  echo First run: extracting from your Spore install...
  python tools\setup.py || (pause & exit /b 1)
)
start "" http://127.0.0.1:8765/app/
python tools\serve.py 8765
