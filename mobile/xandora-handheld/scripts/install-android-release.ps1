param(
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$releaseApkPath = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
$buildScriptPath = Join-Path $androidRoot 'build_release.bat'
$appId = 'com.xandorahandheld'

function Assert-AdbDevice {
  $deviceState = (& adb get-state 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw 'adb is not available on PATH.'
  }

  if ([string]::IsNullOrWhiteSpace($deviceState) -or $deviceState.Trim() -ne 'device') {
    throw 'No Android emulator or device is connected. Connect the phone over USB and rerun the release install.'
  }
}

function Ensure-ReleaseApk {
  if (-not $Rebuild -and (Test-Path $releaseApkPath)) {
    return
  }

  if (-not (Test-Path $buildScriptPath)) {
    throw "Release build script not found at $buildScriptPath"
  }

  Write-Host 'Building the standalone release APK...'
  Push-Location $projectRoot
  try {
    & cmd.exe /c $buildScriptPath
    if ($LASTEXITCODE -ne 0) {
      throw 'Release APK build failed.'
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $releaseApkPath)) {
    throw "Release APK was not created at $releaseApkPath"
  }
}

Write-Host 'Starting adb...'
& adb start-server | Out-Null
Assert-AdbDevice

Ensure-ReleaseApk

Write-Host 'Installing the standalone release app...'
& adb install -r $releaseApkPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'adb install for the release APK failed.'
}

& adb shell am force-stop $appId | Out-Null
& adb shell am start -n "${appId}/.MainActivity" | Out-Null

Write-Host 'Xandora release should now be launching without Metro.'
