@echo off
REM Sul PC le richieste sono alle 14:00 e lo scarico alle 05:00 del mattino dopo.
REM Usare run_ade_rotation_pc.ps1 -Phase request oppure -Phase download.
cd /d "%~dp0\.."
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
".venv\Scripts\python.exe" -u "scripts\ade_sync_rotation.py" %*
exit /b %ERRORLEVEL%
