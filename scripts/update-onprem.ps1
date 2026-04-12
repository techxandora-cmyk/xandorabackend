param(
  [switch]$WithGitPull,
  [switch]$SkipInstall,
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$CommandName)
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Required command '$CommandName' was not found in PATH."
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Step "Validating required tools"
Require-Command "node"
Require-Command "npm"

if ($WithGitPull) {
  Require-Command "git"
  Write-Step "Pulling latest code"
  git pull --ff-only
}

if (-not $SkipInstall) {
  Write-Step "Installing backend dependencies"
  npm install

  Write-Step "Installing dashboard dependencies"
  npm --prefix rfid-dashboard install
}

Write-Step "Running database migrations"
npm run migrate

if (-not $SkipBuild) {
  Write-Step "Building dashboard"
  npm --prefix rfid-dashboard run build
}

Write-Step "Restarting PM2 services"
try {
  npx pm2 restart ecosystem.onprem.config.cjs --update-env
} catch {
  Write-Warning "PM2 restart failed, attempting fresh start."
  npx pm2 start ecosystem.onprem.config.cjs --update-env
}
npx pm2 save
npx pm2 status

Write-Step "API health check"
try {
  $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3000/api/health" -TimeoutSec 10
  Write-Host "API health status: $($health.StatusCode)" -ForegroundColor Green
} catch {
  Write-Warning "API health check failed. Check logs with: npx pm2 logs zyro-api --lines 100 --nostream"
}

Write-Host ""
Write-Host "On-prem update complete." -ForegroundColor Green
