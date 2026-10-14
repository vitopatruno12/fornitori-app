#Requires -Version 5.1
# Scarico una tantum Mediazione: fatture ricevute 01/04/2026-31/07/2026.
# I doppioni (stesso file o stessa fattura gia in Atlas) vengono scartati.
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright"
$env:ADE_HEADLESS = "1"
$env:ADE_USE_SYSTEM_CHROME = "1"
$env:ADE_FAST_LOGIN = "1"
$env:ADE_DEBUG_SCREENSHOTS = "0"
$env:ADE_KEEP_SESSION = "1"
$env:ADE_DATE_FROM = "2026-04-01"
$env:ADE_DATE_TO = "2026-07-31"
$env:ADE_LOOKBACK_DAYS = "130"
$env:ADE_MASS_KINDS = "ricevute"
$env:ADE_ONLY_PROFILE = "mediazione"
$env:ADE_RISPOSTE_ONLY = "1"
$env:ADE_AUTO_ROTATE_PASSWORD = "0"
Remove-Item Env:ADE_RICHIESTE_ONLY -ErrorAction SilentlyContinue
Remove-Item Env:ADE_FORCE_PASSWORD_ROTATE -ErrorAction SilentlyContinue
$env:ADE_PROFILES_PATH = "C:\Users\Francesco10bonba\Desktop\fornitori-app\backend\uploads\ade\profiles.json"
$env:ADE_DEBUG_DIR = "C:\Users\Francesco10bonba\Desktop\fornitori-app\backend\uploads\ade_debug"
$env:ADE_XML_DROP_DIR = "C:\Users\Francesco10bonba\Desktop\fornitori-app\backend\uploads\ade"
$env:ATLAS_API_BASE = "https://www.atlass.it/api"
$env:ADE_STATUS_PUSH = "1"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONIOENCODING = "utf-8"

$py = Join-Path $Backend ".venv-pc\Scripts\python.exe"
& $py (Join-Path $Backend "scripts\ade_sync_agent.py")
$downloadCode = $LASTEXITCODE
# Fatture pagate nel file -> chiudi in Atlas e prepara i mastrini (A e Z).
& $py (Join-Path $Backend "scripts\align_pagamenti_dopo_scarico.py") mediazione_a mediazione_z
if ($downloadCode -ne 0) { exit $downloadCode }
exit $LASTEXITCODE
