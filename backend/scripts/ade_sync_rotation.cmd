@echo off
REM Task Scheduler (PC ufficio): ogni giorno alle 09:00
REM Azione: questo file. La rotazione decide da sola se oggi ci sono scarichi.
cd /d "%~dp0\.."
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
".venv\Scripts\python.exe" -u "scripts\ade_sync_rotation.py" %*
exit /b %ERRORLEVEL%
