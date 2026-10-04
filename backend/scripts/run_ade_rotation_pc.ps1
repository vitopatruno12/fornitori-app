#Requires -Version 5.1
<#
.SYNOPSIS
  AdE su questo PC.
  Ogni 3 giorni alle 14:00: Mediazione A+Z e Via Lattea.
  Ogni 4 giorni alle 14:00: Risacca e PG.
  Scarico il mattino dopo alle 05:00.

.PARAMETER CatchUp
  Solo richieste, tutte le societa', ultimi 21 giorni. Lo scarico resta alle 05:00.
#>
param(
  [switch]$CatchUp,
  [ValidateSet('request', 'download')]
  [string]$Phase = ''
)

$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Backend "app"))) {
  $Backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
}
Set-Location $Backend

$Python = Join-Path $Backend ".venv-pc\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  $Python = Join-Path $Backend ".venv\Scripts\python.exe"
}
$Script = Join-Path $Backend "scripts\ade_sync_rotation.py"
if (-not (Test-Path $Python)) { throw "Manca $Python" }
if (-not (Test-Path $Script)) { throw "Manca $Script" }

$Profiles = "C:\Users\Francesco10bonba\Desktop\fornitori-app\backend\uploads\ade\profiles.json"
if (-not (Test-Path -LiteralPath $Profiles)) {
  $fallback = Join-Path $Backend "uploads\ade\profiles.json"
  if (Test-Path -LiteralPath $fallback) { $Profiles = $fallback }
}
if (-not (Test-Path -LiteralPath $Profiles)) {
  throw "Profili AdE non trovati"
}

$env:ADE_PROFILES_PATH = $Profiles
$env:ADE_PROFILE_TIMEOUT_SEC = "900"
# Il .env punta ancora alle cartelle di un altro utente Windows: da qui non si possono creare.
$env:ADE_XML_DROP_DIR = Join-Path $Backend "uploads\ade"
$env:ADE_DEBUG_DIR = Join-Path $Backend "uploads\ade_debug"
$env:ADE_ROTATION_LOOKBACK_DAYS = "21"
# Ricevute (emesse verso le società, anche se il fornitore non è in anagrafica) ed emesse nostre.
$env:ADE_MASS_KINDS = "ricevute,emesse"
$env:ADE_HEADLESS = "1"
$env:ADE_USE_SYSTEM_CHROME = "1"
$env:ADE_FAST_LOGIN = "1"
$env:ADE_KEEP_SESSION = "1"
$env:ADE_STATUS_PUSH = "1"
$env:ADE_AUTO_ROTATE_PASSWORD = "1"
$env:ATLAS_API_BASE = "https://www.atlass.it/api"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUNBUFFERED = "1"

$LogDir = Join-Path $Backend "uploads\ade_logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$tag = if ($CatchUp) { "catchup" } elseif ($Phase) { $Phase } else { "rotation" }
$LogFile = Join-Path $LogDir ("ade_{0}_{1}.log" -f $tag, $stamp)

function Invoke-Rotation([string[]]$Extra) {
  # Redirect nel file: la pipe di PowerShell 5.1 si blocca sullo stderr di Chrome.
  $argList = @("-u", $Script) + $Extra
  $quoted = $argList | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }
  cmd /c "`"$Python`" $($quoted -join ' ') >> `"$LogFile`" 2>&1"
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    Write-Host "Rotazione uscita $LASTEXITCODE"
  }
}

if ($CatchUp) {
  Invoke-Rotation @("--force", "mediazione,via_lattea", "--phase", "request")
  Invoke-Rotation @("--force", "risacca,pg", "--phase", "request")
  exit 0
}

if ($Phase -eq 'request') {
  Invoke-Rotation @("--phase", "request")
  exit 0
}

if ($Phase -eq 'download') {
  $yesterday = (Get-Date).Date.AddDays(-1).ToString('yyyy-MM-dd')
  Invoke-Rotation @("--phase", "download", "--date", $yesterday)
  exit 0
}

Write-Host "Nessuna fase: richieste alle 14:00, scarico alle 05:00 del mattino dopo."
exit 0
