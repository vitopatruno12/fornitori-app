#Requires -Version 5.1
# Mediazione: richiesta + download massivo 01/01/2026 → 23/09/2026
param(
  [ValidateSet("Request", "Download", "Full")]
  [string]$Mode = "Full",
  [switch]$ForcePasswordRotate
)
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$env:ADE_PROFILES_PATH = if ($env:ADE_PROFILES_PATH) { $env:ADE_PROFILES_PATH } else { Join-Path $Backend "uploads\ade\profiles.json" }
$env:ADE_DATE_FROM = "2026-01-01"
$env:ADE_DATE_TO = "2026-09-23"
$env:ADE_LOOKBACK_DAYS = "270"
$env:ADE_MASS_KINDS = if ($env:ADE_MASS_KINDS) { $env:ADE_MASS_KINDS } else { "ricevute" }
$env:ADE_AUTO_ROTATE_PASSWORD = "1"
if ($ForcePasswordRotate) { $env:ADE_FORCE_PASSWORD_ROTATE = "1" }
$env:ATLAS_API_BASE = if ($env:ATLAS_API_BASE) { $env:ATLAS_API_BASE } else { "https://www.atlass.it/api" }

$Runner = Join-Path $PSScriptRoot "run_ade_sync_ufficio.ps1"
$codeReq = 0
$codeDl = 0

if ($Mode -eq "Request" -or $Mode -eq "Full") {
  Write-Host "Mediazione: REQUEST periodo $($env:ADE_DATE_FROM) → $($env:ADE_DATE_TO)"
  & $Runner -Mode Request -Profiles mediazione -Quiet -ShowBrowser
  $codeReq = $LASTEXITCODE
}

if ($Mode -eq "Download" -or $Mode -eq "Full") {
  Write-Host "Mediazione: DOWNLOAD risposte (periodo $($env:ADE_DATE_FROM) → $($env:ADE_DATE_TO))"
  & $Runner -Mode Download -Profiles mediazione -Quiet -ShowBrowser
  $codeDl = $LASTEXITCODE
}

if ($codeReq -ne 0) { exit $codeReq }
exit $codeDl
