#Requires -Version 5.1
<#
.SYNOPSIS
  Sync AdE (Fisconline) → Atlas sul PC ufficio (Chrome headless + stato per UI).

.PARAMETER Mode
  Request  = genera richiesta massiva Ricevute (pomeriggio 14:00)
  Download = scarica da Risposte e push su Atlas (mattina 06:00)
  Full     = genera + scarica (manuale; browser visibile se ADE_HEADLESS=0)

.USAGE
  .\scripts\run_ade_sync_ufficio.ps1 -Mode Request
  .\scripts\run_ade_sync_ufficio.ps1 -Mode Download
#>
param(
  [ValidateSet("Request", "Download", "Full")]
  [string]$Mode = "Full",
  [string]$Profiles = "",
  [switch]$Setup,
  [switch]$ShowBrowser
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
$LogDir = Join-Path $Backend "uploads\ade_logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LogFile = Join-Path $LogDir ("ade_{0}_{1}.log" -f $Mode.ToLower(), $stamp)

if (-not (Test-Path $VenvPython)) {
  Write-Host "ERRORE: venv non trovato in $Backend\.venv" -ForegroundColor Red
  exit 2
}

$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright"
# Schedulato: headless (niente finestre Chrome). -ShowBrowser o Full → visibile.
if ($ShowBrowser -or $Mode -eq "Full") {
  $env:ADE_HEADLESS = if ($env:ADE_HEADLESS) { $env:ADE_HEADLESS } else { "0" }
} else {
  $env:ADE_HEADLESS = "1"
}
$env:ADE_USE_SYSTEM_CHROME = "1"
$env:ADE_FAST_LOGIN = "1"
$env:ADE_DEBUG_SCREENSHOTS = if ($env:ADE_HEADLESS -eq "1") { "0" } else { "1" }
$env:ADE_KEEP_SESSION = "1"
$env:ADE_LOOKBACK_DAYS = if ($env:ADE_LOOKBACK_DAYS) { $env:ADE_LOOKBACK_DAYS } else { "60" }
$env:ADE_STATUS_PUSH = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUNBUFFERED = "1"
$env:ADE_MASS_KINDS = if ($env:ADE_MASS_KINDS) { $env:ADE_MASS_KINDS } else { "ricevute,emesse" }

Remove-Item Env:ADE_ONLY_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:ADE_RISPOSTE_ONLY -ErrorAction SilentlyContinue
Remove-Item Env:ADE_RICHIESTE_ONLY -ErrorAction SilentlyContinue
if ($Profiles) {
  $env:ADE_ONLY_PROFILE = $Profiles
}

switch ($Mode) {
  "Request" { $env:ADE_RICHIESTE_ONLY = "1" }
  "Download" { $env:ADE_RISPOSTE_ONLY = "1" }
}

if ($Setup) {
  Write-Host "=== Setup agent AdE ===" -ForegroundColor Cyan
  & $VenvPip install -r (Join-Path $Backend "requirements-ade-agent.txt")
  & $Playwright install chrome
  Write-Host "Setup OK. Rilancia senza -Setup." -ForegroundColor Green
  exit 0
}

$who = if ($Profiles) { $Profiles } else { "tutte (enabled)" }
Write-Host "AdE sync Mode=$Mode headless=$($env:ADE_HEADLESS) profili=$who" -ForegroundColor Cyan
Write-Host "Log: $LogFile"

# Finestra progresso locale (non è Chrome AdE)
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$form = New-Object System.Windows.Forms.Form
$form.Text = "Atlas - Aggiornamento fatture AdE"
$form.Size = New-Object System.Drawing.Size(480, 160)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Size = New-Object System.Drawing.Size(440, 40)
$label.Location = New-Object System.Drawing.Point(16, 16)
$label.Text = if ($Mode -eq "Request") {
  "Collegamento all'Agenzia delle Entrate - fase richiesta..."
} elseif ($Mode -eq "Download") {
  "Collegamento all'Agenzia delle Entrate - fase scarico..."
} else {
  "Collegamento all'Agenzia delle Entrate..."
}
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = "Marquee"
$bar.MarqueeAnimationSpeed = 30
$bar.Size = New-Object System.Drawing.Size(440, 24)
$bar.Location = New-Object System.Drawing.Point(16, 70)
$form.Controls.Add($label)
$form.Controls.Add($bar)
$form.Show()
$form.Refresh()
[System.Windows.Forms.Application]::DoEvents()

$script = Join-Path $Backend "scripts\ade_sync_agent.py"
$proc = Start-Process -FilePath $VenvPython -ArgumentList "`"$script`"" `
  -WorkingDirectory $Backend -PassThru -NoNewWindow `
  -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err"

$statusFile = Join-Path $Backend "uploads\ade\agent_status.json"
while (-not $proc.HasExited) {
  Start-Sleep -Milliseconds 800
  if (Test-Path $statusFile) {
    try {
      $st = Get-Content $statusFile -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($st.message) { $label.Text = [string]$st.message }
      if ($st.progress -gt 0) {
        $bar.Style = "Continuous"
        $bar.Value = [Math]::Min(100, [int]$st.progress)
      }
    } catch { }
  }
  $form.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}

$code = $proc.ExitCode
try {
  $st = if (Test-Path $statusFile) { Get-Content $statusFile -Raw | ConvertFrom-Json } else { $null }
} catch { $st = $null }

$form.Close()
$form.Dispose()

if ($code -eq 0 -or ($st -and $st.ok -eq $true)) {
  [System.Windows.Forms.MessageBox]::Show(
    $(if ($st -and $st.message) { [string]$st.message } else { "Fatture aggiornate - nuovo scarico completato." }),
    "Assistente Atlas",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  exit 0
}

$errMsg = if ($st -and $st.error) { [string]$st.error } elseif ($st -and $st.message) { [string]$st.message } else { "Errore sync AdE (exit=$code). Vedi log: $LogFile" }
[System.Windows.Forms.MessageBox]::Show(
  $errMsg,
  "Assistente Atlas - errore",
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Error
) | Out-Null
exit $(if ($code) { $code } else { 1 })
