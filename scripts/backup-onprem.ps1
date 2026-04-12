param(
  [string]$OutDir = "backups"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Step "Creating backup into '$OutDir'"
node .\scripts\backup_db.js --outdir $OutDir

Write-Host ""
Write-Host "Backup completed." -ForegroundColor Green
