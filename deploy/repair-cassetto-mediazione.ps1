# Ripara movimenti cassetto Mediazione (Abba + Zanardelli) dal 1 ottobre a oggi.
# Eseguire su CIASCUNA cassa (C:\AtlasSync), con MODEL_ID corretto nel .env:
#   Abba:       EASYRETAIL_MODEL_ID=model-2
#   Zanardelli: EASYRETAIL_MODEL_ID=model-4
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File repair-cassetto-mediazione.ps1

$ErrorActionPreference = "Stop"
$Root = if (Test-Path "C:\AtlasSync\easyretail_gdb_sync_agent.py") {
  "C:\AtlasSync"
} else {
  Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $PSScriptRoot "..\backend\scripts\easyretail_gdb_sync_agent.py")) {
    # repo locale: backend/scripts
  }
  "C:\AtlasSync"
}

Set-Location $Root
$agent = Join-Path $Root "easyretail_gdb_sync_agent.py"
if (-not (Test-Path $agent)) {
  Write-Host "ERRORE: manca $agent — copia prima lo script aggiornato in C:\AtlasSync"
  exit 2
}

$from = "2026-10-01"
$to = (Get-Date).ToString("yyyy-MM-dd")
Write-Host "Repair cassetto $from → $to in $Root"
py -u $agent --repair-cassetto-from $from --repair-cassetto-to $to
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "OK. Controlla Prima Nota Abba e Zanardelli: MIWA solo sul locale che l'ha fatto."
