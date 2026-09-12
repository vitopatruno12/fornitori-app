#Requires -Version 5.1
<#
.SYNOPSIS
  Installa Task Scheduler AdE → Atlas (ogni 3 giorni).

  - AtlasAdeRichiesteFatture  → 14:00  genera richieste massime (tutte le società)
  - AtlasAdeScaricoFatture    → 06:00  scarica ZIP + push Atlas

.USAGE
  PowerShell (consigliato come Amministratore, stesso utente di Chrome):
    cd C:\Users\vpatr\fornitori-app\backend
    .\scripts\install_ade_sync_tasks.ps1

  Opzionale:
    .\scripts\install_ade_sync_tasks.ps1 -FirstRequestDate "2026-09-15" -FirstDownloadDate "2026-09-16"
    .\scripts\install_ade_sync_tasks.ps1 -RemoveOnly
#>
param(
  [string]$FirstRequestDate = "",
  [string]$FirstDownloadDate = "",
  [switch]$RemoveOnly
)

$ErrorActionPreference = "Stop"

$Backend = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Backend "app"))) {
  $Backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
}
$Runner = Join-Path $Backend "scripts\run_ade_sync_ufficio.ps1"
if (-not (Test-Path $Runner)) {
  throw "Manca $Runner"
}

$TaskRequest = "AtlasAdeRichiesteFatture"
$TaskDownload = "AtlasAdeScaricoFatture"
$Pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

function Remove-AdeTask([string]$Name) {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

Remove-AdeTask $TaskRequest
Remove-AdeTask $TaskDownload

if ($RemoveOnly) {
  Write-Host "Task AdE rimossi." -ForegroundColor Yellow
  exit 0
}

$today = (Get-Date).Date
if ($FirstRequestDate) {
  $reqDate = [datetime]::Parse($FirstRequestDate).Date
} else {
  $reqDate = $today.AddDays(1)
}

if ($FirstDownloadDate) {
  $dlDate = [datetime]::Parse($FirstDownloadDate).Date
} else {
  # Mattina dopo la richiesta (AdE elabora di notte)
  $dlDate = $reqDate.AddDays(1)
}

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -WakeToRun

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$Principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest

function Register-AdeEvery3Days {
  param(
    [string]$TaskName,
    [string]$Mode,
    [datetime]$StartDate,
    [string]$TimeOfDay,
    [string]$Description
  )

  $action = New-ScheduledTaskAction `
    -Execute $Pwsh `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -Mode {0}" -f $Mode) `
    -WorkingDirectory $Backend

  # Trigger giornaliero con intervallo 3 giorni
  $at = [datetime]::ParseExact(
    ($StartDate.ToString("yyyy-MM-dd") + " " + $TimeOfDay),
    "yyyy-MM-dd HH:mm",
    [System.Globalization.CultureInfo]::InvariantCulture
  )
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  $trigger.DaysInterval = 3
  # StartBoundary = prima esecuzione
  $trigger.StartBoundary = $at.ToString("s")

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description $Description `
    -Force | Out-Null

  return $at
}

$reqAt = Register-AdeEvery3Days `
  -TaskName $TaskRequest `
  -Mode "Request" `
  -StartDate $reqDate `
  -TimeOfDay "14:00" `
  -Description "AdE ogni 3 giorni 14:00: genera richieste massive fatture ricevute (tutte le societa) per Atlas"

$dlAt = Register-AdeEvery3Days `
  -TaskName $TaskDownload `
  -Mode "Download" `
  -StartDate $dlDate `
  -TimeOfDay "06:00" `
  -Description "AdE ogni 3 giorni 06:00: scarica risposte mass-web e aggiorna Atlas (tutte le societa)"

Write-Host ""
Write-Host "Task creati (utente: $userId)" -ForegroundColor Green
Write-Host ("  {0}" -f $TaskRequest)
Write-Host ("    prima = {0:yyyy-MM-dd HH:mm}  poi ogni 3 giorni  Mode=Request" -f $reqAt)
Write-Host ("  {0}" -f $TaskDownload)
Write-Host ("    prima = {0:yyyy-MM-dd HH:mm}  poi ogni 3 giorni  Mode=Download" -f $dlAt)
Write-Host ""
Write-Host "PC acceso/sveglio a quegli orari; utente loggato consigliato (Chrome headed)."
Write-Host "Log: $Backend\uploads\ade_logs\"
Write-Host ""
Get-ScheduledTask -TaskName $TaskRequest, $TaskDownload | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo
  [pscustomobject]@{
    Task = $_.TaskName
    State = $_.State
    NextRun = $info.NextRunTime
  }
} | Format-Table -AutoSize
