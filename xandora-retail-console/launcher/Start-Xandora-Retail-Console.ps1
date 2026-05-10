Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pidFile = Join-Path $root ".demo-server.pid"
$outLog = Join-Path $root ".demo-server.out.log"
$errLog = Join-Path $root ".demo-server.err.log"
$skipBrowser = $env:XANDORA_RETAIL_CONSOLE_SKIP_BROWSER -eq "1"

function Test-Health {
  try {
    Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4300/api/health" -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Open-Browser {
  if ($skipBrowser) {
    return
  }
  & (Join-Path $PSScriptRoot "Open-xandora-Retail-Console-Edge.bat")
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found in PATH. Install Node.js 20+ and try again." -ForegroundColor Red
  exit 1
}

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -Raw).Trim()
  if ($existingPid) {
    $existingProc = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
    if ($existingProc) {
      Write-Host "Xandora Retail Console is already running on PID $existingPid."
      Open-Browser
      exit 0
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$moduleCheck = & node -e "require.resolve('express'); require.resolve('cors');"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing console dependencies..."
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install dependencies." -ForegroundColor Red
    exit 1
  }
}

Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue

$proc = Start-Process node `
  -ArgumentList "backend/server.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii
Write-Host "Xandora Retail Console started with PID $($proc.Id)."

$healthy = $false
for ($i = 0; $i -lt 20; $i += 1) {
  if (Test-Health) {
    $healthy = $true
    break
  }
  Start-Sleep -Milliseconds 900
}

if (-not $healthy) {
  Write-Host "Console failed health check on http://127.0.0.1:4300/api/health" -ForegroundColor Red
  $runningProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($runningProc) {
    Write-Host "Server process is still running, but API did not respond."
  } else {
    Write-Host "Server process exited during startup."
  }

  if (Test-Path $errLog) {
    Write-Host ""
    Write-Host "Last startup errors:" -ForegroundColor Yellow
    Get-Content $errLog -Tail 20
  }

  Write-Host ""
  Write-Host "Check logs:"
  Write-Host "  $outLog"
  Write-Host "  $errLog"
  exit 1
}

Write-Host "Xandora Retail Console is ready."
Open-Browser
exit 0
