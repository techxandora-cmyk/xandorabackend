Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pidFile = Join-Path $root ".demo-server.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "No running demo PID file found."
  exit 0
}

$pidText = (Get-Content $pidFile -Raw).Trim()
if (-not $pidText) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "PID file was empty. Cleared."
  exit 0
}

$targetPid = [int]$pidText
Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Stopped Xandora Retail Console (PID $targetPid)."
exit 0
