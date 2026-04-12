param(
  [switch]$SkipDocker,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipPm2Start
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
if (-not $SkipDocker) {
  Require-Command "docker"
}

if (-not (Test-Path ".env")) {
  Write-Step "Creating .env from .env.example"
  Copy-Item ".env.example" ".env"
  Write-Warning "Review .env and set secure secrets before production use."
}

if (-not $SkipInstall) {
  Write-Step "Installing backend dependencies"
  npm install

  Write-Step "Installing dashboard dependencies"
  npm --prefix rfid-dashboard install
}

if (-not $SkipDocker) {
  Write-Step "Starting local service dependencies (postgres, rabbitmq, redis)"
  docker compose up -d postgres rabbitmq redis
}

Write-Step "Running database migrations"
npm run migrate

if (-not $SkipBuild) {
  Write-Step "Building dashboard"
  npm --prefix rfid-dashboard run build
}

if (-not $SkipPm2Start) {
  Write-Step "Starting Zyro services with PM2"
  npx pm2 start ecosystem.onprem.config.cjs --update-env
  npx pm2 save
  npx pm2 status
}

Write-Step "API health check"
try {
  $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3000/api/health" -TimeoutSec 10
  Write-Host "API health status: $($health.StatusCode)" -ForegroundColor Green
} catch {
  Write-Warning "API health check failed. Check logs with: npx pm2 logs zyro-api --lines 100 --nostream"
}

Write-Host ""
Write-Host "On-prem install complete." -ForegroundColor Green
Write-Host "Dashboard URL: http://127.0.0.1:5173"
Write-Host "API URL: http://127.0.0.1:3000"
