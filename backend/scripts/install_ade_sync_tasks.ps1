#Requires -Version 5.1
<#
.SYNOPSIS
  Installa Task Scheduler AdE → Atlas (ogni 3 giorni, tutte le società).

  - AtlasAdeRichiesteFatture  → 14:00  genera richieste massime + auto-rinnovo password se serve
  - AtlasAdeScaricoFatture    → 06:00  scarica ZIP + push Atlas + auto-rinnovo password se serve
  - AtlasAdeUiListener        → all'accesso  ascolta «Aggiorna da AdE» da Atlas

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
$Listener = Join-Path $Backend "scripts\ade_agent_ui_listener.py"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $Runner)) {
  throw "Manca $Runner"
}

$TaskRequest = "AtlasAdeRichiesteFatture"
$TaskDownload = "AtlasAdeScaricoFatture"
$TaskListener = "AtlasAdeUiListener"
$Pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

function Remove-AdeTask([string]$Name) {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

Remove-AdeTask $TaskRequest
Remove-AdeTask $TaskDownload
Remove-AdeTask $TaskListener

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
$Principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

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
    -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`" -Mode {0} -Quiet" -f $Mode) `
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
  -Description "AdE ogni 3 giorni 14:00: richieste massive ricevute+emesse (tutte le societa) + auto-rinnovo password Fisconline Atlas headless"

$dlAt = Register-AdeEvery3Days `
  -TaskName $TaskDownload `
  -Mode "Download" `
  -StartDate $dlDate `
  -TimeOfDay "06:00" `
  -Description "AdE ogni 3 giorni 06:00: scarico risposte + push Atlas + auto-rinnovo password se in scadenza (tutte le societa) headless"

# Listener: a ogni accesso Windows ascolta «Aggiorna da AdE» da Atlas (tutte le società / profilo UI)
if ((Test-Path $VenvPython) -and (Test-Path $Listener)) {
  $listenerSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Days 3) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

  $listenerAction = New-ScheduledTaskAction `
    -Execute $VenvPython `
    -Argument ("`"{0}`"" -f $Listener) `
    -WorkingDirectory $Backend

  $listenerTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

  Register-ScheduledTask `
    -TaskName $TaskListener `
    -Action $listenerAction `
    -Trigger $listenerTrigger `
    -Settings $listenerSettings `
    -Principal $Principal `
    -Description "Listener AdE: scarico on-demand da Atlas + auto-rinnovo password (tutte le societa)" `
    -Force | Out-Null

  # Avvia subito se non già in esecuzione
  try {
    Start-ScheduledTask -TaskName $TaskListener -ErrorAction SilentlyContinue
  } catch { }
} else {
  Write-Host "AVVISO: listener non installato (manca venv o ade_agent_ui_listener.py)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Task creati (utente: $userId) - background headless" -ForegroundColor Green
Write-Host ("  {0}" -f $TaskRequest)
Write-Host ("    prima = {0:yyyy-MM-dd HH:mm}  poi ogni 3 giorni  Mode=Request" -f $reqAt)
Write-Host ("  {0}" -f $TaskDownload)
Write-Host ("    prima = {0:yyyy-MM-dd HH:mm}  poi ogni 3 giorni  Mode=Download" -f $dlAt)
Write-Host ("  {0}  (AtLogOn + avvio ora)" -f $TaskListener)
Write-Host ""
Write-Host "PC acceso (o sveglio) a quegli orari; utente vpatr loggato consigliato."
Write-Host "Kinds: ricevute,emesse | Auto-password: ADE_AUTO_ROTATE_PASSWORD=1 | Log: $Backend\uploads\ade_logs"
Write-Host "Profili: tutte le societa abilitate in profiles.json (Mediazione, Via Lattea, Risacca, PG)."
Write-Host ""
Get-ScheduledTask -TaskName $TaskRequest, $TaskDownload, $TaskListener -ErrorAction SilentlyContinue | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo
  [pscustomobject]@{
    Task = $_.TaskName
    State = $_.State
    NextRun = $info.NextRunTime
  }
} | Format-Table -AutoSize
