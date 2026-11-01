@echo off
title JobHunter setup
cd /d "%~dp0"
echo.
echo === JobHunter setup ===
echo [1/3] Python environment...
where uv >nul 2>nul
if %errorlevel%==0 (
  uv venv .venv --python 3.12 || uv venv .venv
  uv pip install --python .venv\Scripts\python.exe -r requirements.txt
) else (
  py -3 -m venv .venv 2>nul || python -m venv .venv
  .venv\Scripts\python.exe -m pip install --upgrade pip
  .venv\Scripts\python.exe -m pip install -r requirements.txt
)
if not exist .venv\Scripts\python.exe (
  echo Python was not found. Install Python 3.11+ from python.org and run setup again.
  pause & exit /b 1
)
echo [2/3] Node scraper dependencies...
pushd scraper
call npm install --no-audit --no-fund
popd
echo [3/3] Desktop shortcut...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\JobHunter.lnk');$s.TargetPath='%~dp0start.bat';$s.WorkingDirectory='%~dp0';$s.IconLocation='%SystemRoot%\System32\shell32.dll,22';$s.Save()"
echo.
echo Done. Double-click "JobHunter" on your desktop (or start.bat) to launch.
echo Optional: run autostart_on.bat so the app (and its daily import/fallback scrape) starts when you log in.
pause
