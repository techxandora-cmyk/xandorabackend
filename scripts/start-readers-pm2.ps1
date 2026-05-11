param(
  [string]$Pm2AppFile = "ecosystem.readers.config.cjs"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Starting reader bridge(s) with PM2 from $Pm2AppFile" -ForegroundColor Cyan

npx pm2 start $Pm2AppFile --update-env
if ($LASTEXITCODE -ne 0) {
  throw "PM2 failed to start reader bridge(s)."
}

npx pm2 save
if ($LASTEXITCODE -ne 0) {
  throw "PM2 failed to save the current process list."
}

npx pm2 status
if ($LASTEXITCODE -ne 0) {
  throw "PM2 status check failed."
}

Write-Host ""
Write-Host "Reader bridge PM2 startup complete." -ForegroundColor Green
Write-Host "Use 'npx pm2 logs' to inspect live bridge output." -ForegroundColor DarkGray
