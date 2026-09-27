#Requires -Version 5.1
# Richieste AdE ricevute+emesse 01/01/2026 → 22/09/2026, tutte le società.
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$env:ADE_DATE_FROM = "2026-01-01"
$env:ADE_DATE_TO = "2026-09-22"
$env:ADE_LOOKBACK_DAYS = "265"
$env:ADE_MASS_KINDS = "ricevute,emesse"
$env:ATLAS_API_BASE = if ($env:ATLAS_API_BASE) { $env:ATLAS_API_BASE } else { "https://www.atlass.it/api" }

$Runner = Join-Path $PSScriptRoot "run_ade_sync_ufficio.ps1"
Write-Host "AdE REQUEST periodo $($env:ADE_DATE_FROM) → $($env:ADE_DATE_TO) kinds=$($env:ADE_MASS_KINDS)"
& $Runner -Mode Request -Quiet
exit $LASTEXITCODE
