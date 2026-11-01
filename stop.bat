@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*JobHunter*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo JobHunter stopped.
timeout /t 2 >nul
