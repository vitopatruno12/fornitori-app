#Requires -Version 5.1
# Mediazione: rinnova password Fisconline (se possibile) + richiesta scarico 01/01/2026 → 25/09/2026
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$env:ADE_PROFILES_PATH = if ($env:ADE_PROFILES_PATH) { $env:ADE_PROFILES_PATH } else { Join-Path $Backend "uploads\ade\profiles.json" }
$env:ADE_DATE_FROM = "2026-01-01"
$env:ADE_DATE_TO = "2026-09-25"
$env:ADE_LOOKBACK_DAYS = "270"
$env:ADE_MASS_KINDS = "ricevute,emesse"
$env:ADE_FORCE_PASSWORD_ROTATE = "1"
$env:ADE_AUTO_ROTATE_PASSWORD = "1"
$env:ATLAS_API_BASE = if ($env:ATLAS_API_BASE) { $env:ATLAS_API_BASE } else { "https://www.atlass.it/api" }

$Runner = Join-Path $PSScriptRoot "run_ade_sync_ufficio.ps1"
Write-Host "Mediazione: password rotate + REQUEST periodo $($env:ADE_DATE_FROM) → $($env:ADE_DATE_TO)"
& $Runner -Mode Request -Profiles mediazione -Quiet -ShowBrowser
$codeReq = $LASTEXITCODE

Write-Host "Mediazione: DOWNLOAD risposte disponibili (stesso periodo)"
& $Runner -Mode Download -Profiles mediazione -Quiet -ShowBrowser
$codeDl = $LASTEXITCODE

if ($codeReq -ne 0) { exit $codeReq }
exit $codeDl
