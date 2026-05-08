@echo off
setlocal EnableExtensions

set "URL=http://127.0.0.1:4300"
set "EDGE_X86=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_X64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE_X64%" (
  start "" "%EDGE_X64%" --kiosk "%URL%" --edge-kiosk-type=fullscreen
  exit /b 0
)

if exist "%EDGE_X86%" (
  start "" "%EDGE_X86%" --kiosk "%URL%" --edge-kiosk-type=fullscreen
  exit /b 0
)

if exist "%CHROME%" (
  start "" "%CHROME%" --start-fullscreen --kiosk "%URL%"
  exit /b 0
)

start "" "%URL%"
exit /b 0
