param(
  [string]$TaskName = "Xandora Reader Bridge PM2",
  [string]$Pm2AppFile = "ecosystem.readers.config.cjs"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-readers-pm2.ps1"

if (-not (Test-Path $startScript)) {
  throw "Missing startup script: $startScript"
}

$escapedScript = '"' + $startScript + '"'
$escapedAppFile = '"' + $Pm2AppFile + '"'

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $escapedScript -Pm2AppFile $escapedAppFile" `
  -WorkingDirectory $repoRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Host "Scheduled task registered: $TaskName" -ForegroundColor Green
Write-Host "It will start the reader PM2 bridge at Windows logon." -ForegroundColor DarkGray
