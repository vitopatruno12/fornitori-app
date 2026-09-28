#Requires -Version 5.1
# Risacca + PG Gazza Ladra: richiesta + download massivo da inizio anno a oggi.
param(
  [ValidateSet("Request", "Download", "Full")]
  [string]$Mode = "Full",
  [string]$Profiles = "risacca,pg",
  [switch]$ForcePasswordRotate
)
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
Set-Location $Backend

$today = Get-Date -Format "yyyy-MM-dd"
$env:ADE_PROFILES_PATH = if ($env:ADE_PROFILES_PATH) { $env:ADE_PROFILES_PATH } else { Join-Path $Backend "uploads\ade\profiles.json" }
$env:ADE_DATE_FROM = if ($env:ADE_DATE_FROM) { $env:ADE_DATE_FROM } else { "2026-01-01" }
$env:ADE_DATE_TO = if ($env:ADE_DATE_TO) { $env:ADE_DATE_TO } else { $today }
$env:ADE_LOOKBACK_DAYS = "280"
$env:ADE_MASS_KINDS = if ($env:ADE_MASS_KINDS) { $env:ADE_MASS_KINDS } else { "ricevute" }
$env:ADE_AUTO_ROTATE_PASSWORD = "1"
$env:ADE_MAX_RISPOSTE_ZIPS = if ($env:ADE_MAX_RISPOSTE_ZIPS) { $env:ADE_MAX_RISPOSTE_ZIPS } else { "12" }
if ($ForcePasswordRotate) { $env:ADE_FORCE_PASSWORD_ROTATE = "1" }
$env:ATLAS_API_BASE = if ($env:ATLAS_API_BASE) { $env:ATLAS_API_BASE } else { "https://www.atlass.it/api" }

$Runner = Join-Path $PSScriptRoot "run_ade_sync_ufficio.ps1"
$profileList = @($Profiles -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($profileList.Count -eq 0) {
  Write-Error "Nessun profilo specificato"
  exit 2
}

Write-Host "AdE YTD periodo $($env:ADE_DATE_FROM) → $($env:ADE_DATE_TO) profili=$($profileList -join ', ') mode=$Mode"

$failed = @()
foreach ($profile in $profileList) {
  $codeReq = 0
  $codeDl = 0

  if ($Mode -eq "Request" -or $Mode -eq "Full") {
    Write-Host ""
    Write-Host "=== $profile REQUEST ===" -ForegroundColor Cyan
    & $Runner -Mode Request -Profiles $profile -Quiet -ShowBrowser
    $codeReq = $LASTEXITCODE
    if ($codeReq -ne 0) {
      Write-Host "$profile REQUEST exit=$codeReq" -ForegroundColor Yellow
      $failed += "$profile:request=$codeReq"
    }
  }

  if ($Mode -eq "Download" -or $Mode -eq "Full") {
    Write-Host ""
    Write-Host "=== $profile DOWNLOAD ===" -ForegroundColor Cyan
    & $Runner -Mode Download -Profiles $profile -Quiet -ShowBrowser
    $codeDl = $LASTEXITCODE
    if ($codeDl -ne 0) {
      Write-Host "$profile DOWNLOAD exit=$codeDl" -ForegroundColor Yellow
      $failed += "$profile:download=$codeDl"
    }
  }
}

if ($failed.Count -gt 0) {
  Write-Host "Completato con errori: $($failed -join '; ')" -ForegroundColor Red
  exit 1
}
Write-Host "Completato OK per $($profileList -join ', ')" -ForegroundColor Green
exit 0
