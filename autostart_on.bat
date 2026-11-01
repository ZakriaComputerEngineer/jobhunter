@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\JobHunter.lnk');$s.TargetPath='%~dp0.venv\Scripts\pythonw.exe';$s.Arguments='app.py --no-browser';$s.WorkingDirectory='%~dp0';$s.Save()"
echo JobHunter will now start (in the background) every time you log in.
pause
