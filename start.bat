@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe call setup.bat
rem restart if already running so code updates take effect
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*JobHunter*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0app.py"
