#Requires -Version 5.1
<#
.SYNOPSIS
  Lancia sync AdE (chiavetta CNS) → Atlas sul PC ufficio.

.USAGE
  1. Inserisci la chiavetta CNS nel lettore di QUESTO PC
  2. Apri PowerShell e:
       cd C:\Users\vpatr\fornitori-app\backend
       .\scripts\run_ade_sync_ufficio.ps1
  3. Quando Windows chiede il PIN della chiavetta, inseriscilo

.NOTES
  Prima volta (una tantum):
    .\scripts\run_ade_sync_ufficio.ps1 -Setup
#>
param(
  [switch]$Setup
)

$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Backend "app"))) {
  $Backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
}
Set-Location $Backend

$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Backend ".venv\Scripts\pip.exe"
$Playwright = Join-Path $Backend ".venv\Scripts\playwright.exe"

if (-not (Test-Path $VenvPython)) {
  Write-Host "ERRORE: venv non trovato in $Backend\.venv" -ForegroundColor Red
  Write-Host "Crea: python -m venv .venv  poi  .\.venv\Scripts\pip install -r requirements.txt"
  exit 2
}

$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright"
$env:ADE_HEADLESS = "0"
$env:ADE_USE_SYSTEM_CHROME = "1"

if ($Setup) {
  Write-Host "=== Setup agent AdE ===" -ForegroundColor Cyan
  & $VenvPip install -r (Join-Path $Backend "requirements-ade-agent.txt")
  & $Playwright install chrome
  Write-Host "Setup OK. Rilancia senza -Setup con chiavetta inserita." -ForegroundColor Green
  exit 0
}

Write-Host "AdE sync ufficio — chiavetta CNS deve essere su QUESTO PC" -ForegroundColor Cyan
Write-Host "Backend: $Backend"
& $VenvPython (Join-Path $Backend "scripts\ade_sync_agent.py")
exit $LASTEXITCODE
