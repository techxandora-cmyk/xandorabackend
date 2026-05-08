@echo off
setlocal EnableExtensions
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Xandora-Retail-Console.ps1"
exit /b %ERRORLEVEL%
