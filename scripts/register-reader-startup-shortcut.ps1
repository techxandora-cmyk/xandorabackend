param(
  [string]$ShortcutName = "Xandora Reader Bridge.lnk",
  [string]$Pm2AppFile = "ecosystem.readers.config.cjs"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-readers-pm2.ps1"

if (-not (Test-Path $startScript)) {
  throw "Missing startup script: $startScript"
}

$startupFolder = [Environment]::GetFolderPath("Startup")
if (-not (Test-Path $startupFolder)) {
  throw "Windows Startup folder was not found."
}

$shortcutPath = Join-Path $startupFolder $ShortcutName
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -Pm2AppFile `"$Pm2AppFile`""

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Starts the Xandora RFID reader bridge with PM2 at Windows login."
$shortcut.Save()

Write-Host "Startup shortcut registered: $shortcutPath" -ForegroundColor Green
Write-Host "The reader bridge will start automatically when this Windows user logs in." -ForegroundColor DarkGray
