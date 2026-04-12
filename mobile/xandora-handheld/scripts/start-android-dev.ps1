param(
  [switch]$SkipAndroidLaunch
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot '.logs'
$appId = 'com.xandorahandheld'
$preferenceFileName = "${appId}_preferences.xml"
$localPreferencePath = Join-Path $logsDir $preferenceFileName
$devicePreferencePath = "/data/local/tmp/$preferenceFileName"
$appPreferencePath = "/data/user/0/$appId/shared_prefs/$preferenceFileName"
$metroOutLog = Join-Path $logsDir 'metro.out.log'
$metroErrLog = Join-Path $logsDir 'metro.err.log'
$metroStatusUrl = 'http://127.0.0.1:8081/status'

function Test-MetroRunning {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $metroStatusUrl -TimeoutSec 3
    $content = $response.Content
    if ($content -is [byte[]]) {
      $content = [System.Text.Encoding]::UTF8.GetString($content)
    }
    return [string]$content -match 'packager-status:running'
  } catch {
    return $false
  }
}

function Ensure-Metro {
  if (Test-MetroRunning) {
    return
  }

  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Set-Location '$projectRoot'; npm start"
    ) `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $metroOutLog `
    -RedirectStandardError $metroErrLog `
    -WindowStyle Hidden | Out-Null

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-MetroRunning) {
      return
    }
  }

  throw "Metro did not start on port 8081. Check $metroErrLog."
}

function Assert-AdbDevice {
  $deviceState = (& adb get-state 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw 'adb is not available on PATH.'
  }

  if ([string]::IsNullOrWhiteSpace($deviceState) -or $deviceState.Trim() -ne 'device') {
    throw 'No Android emulator or device is connected. Start one, then rerun npm run android:dev.'
  }
}

function Write-DebugHostPreference {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

  @"
<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<map>
    <string name="debug_http_host">localhost:8081</string>
</map>
"@ | Out-File -FilePath $localPreferencePath -Encoding ascii -Force

  & adb push $localPreferencePath $devicePreferencePath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to push the React Native debug host preference to the device."
  }

  & adb shell run-as $appId cp $devicePreferencePath $appPreferencePath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to write the React Native debug host preference for $appId."
  }
}

Write-Host 'Starting Metro if needed...'
Ensure-Metro

Write-Host 'Starting adb...'
& adb start-server | Out-Null
Assert-AdbDevice

Write-Host 'Creating the Metro tunnel...'
& adb reverse tcp:8081 tcp:8081 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'adb reverse tcp:8081 tcp:8081 failed.'
}

if ($SkipAndroidLaunch) {
  Write-Host 'Metro and adb are ready.'
  return
}

Write-Host 'Installing and opening Xandora Handheld...'
Push-Location $projectRoot
try {
  & npx react-native run-android --active-arch-only
  if ($LASTEXITCODE -ne 0) {
    throw 'react-native run-android failed.'
  }
} finally {
  Pop-Location
}

Write-Host 'Pinning the React Native debug host to localhost:8081...'
Write-DebugHostPreference

& adb shell am force-stop $appId | Out-Null
& adb shell am start -n "${appId}/.MainActivity" | Out-Null

Write-Host 'Xandora Handheld should now be launching.'
Write-Host "Metro logs: $metroOutLog"
