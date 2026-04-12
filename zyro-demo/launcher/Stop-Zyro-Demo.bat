@echo off
setlocal EnableExtensions
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Zyro-Demo.ps1"
exit /b %ERRORLEVEL%
