# Atlas EasyRetail sync - Task Scheduler ogni 3 minuti
# Preferibile: PowerShell come Amministratore
#   powershell -ExecutionPolicy Bypass -File C:\AtlasSync\install_sync_task.ps1

$ErrorActionPreference = "Stop"

$TaskName = "AtlasEasyRetailGdbSync"
$WorkDir = "C:\AtlasSync"
$Script = Join-Path $WorkDir "easyretail_gdb_sync_agent.py"

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$Python = $null
$PyArgs = $null
foreach ($candidate in @(
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "C:\Python313\python.exe",
        "C:\Python312\python.exe"
    )) {
    if (Test-Path $candidate) {
        $Python = $candidate
        break
    }
}
if (-not $Python) {
    $cmd = Get-Command py -ErrorAction SilentlyContinue
    if ($cmd) {
        $Python = $cmd.Source
        $PyArgs = "-3 `"$Script`""
    }
}
if (-not $Python) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $Python = $cmd.Source }
}
if (-not $Python) {
    throw "python.exe / py non trovato"
}
if (-not (Test-Path $Script)) {
    throw "Manca easyretail_gdb_sync_agent.py in C:\AtlasSync"
}
if (-not (Test-Path (Join-Path $WorkDir ".env"))) {
    Write-Warning "Manca C:\AtlasSync\.env - l'agent potrebbe non partire"
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

if ($PyArgs) {
    $Action = New-ScheduledTaskAction -Execute $Python -Argument $PyArgs -WorkingDirectory $WorkDir
} else {
    $Action = New-ScheduledTaskAction -Execute $Python -Argument "`"$Script`"" -WorkingDirectory $WorkDir
}
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 3) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$isAdmin = Test-IsAdmin
if ($isAdmin) {
    $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Write-Host "Registro task come SYSTEM (Amministratore)."
} else {
    $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Write-Warning "Non sei Amministratore: registro il task per l'utente $env:USERNAME (serve login attivo)."
}

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "Sync EasyRetail GDB verso ATLAS ogni 3 minuti" | Out-Null
} catch {
    Write-Host ""
    Write-Host "ERRORE: impossibile creare il task. Apri PowerShell come Amministratore:"
    Write-Host "  1) Start -> digita PowerShell"
    Write-Host "  2) tasto destro -> Esegui come amministratore"
    Write-Host "  3) cd C:\AtlasSync"
    Write-Host "  4) powershell -ExecutionPolicy Bypass -File .\install_sync_task.ps1"
    Write-Host ""
    throw
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult, NextRunTime
Write-Host "OK task creato. LastTaskResult 0 = successo."
