@echo off
:: Doppio-click: chiede UAC e reinstalla i task AdE Atlas (richieste + scarico).
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0install_ade_sync_tasks.ps1\" -FirstRequestDate 2026-09-15 -FirstDownloadDate 2026-09-16' -Wait"
echo.
pause
