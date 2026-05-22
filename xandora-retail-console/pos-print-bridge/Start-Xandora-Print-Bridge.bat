@echo off
setlocal EnableExtensions

set "BRIDGE_DIR=%~dp0"
set "XANDORA_PRINTER_NAME=POS CV2"
set "XANDORA_PAPER_WIDTH_MM=80"

cd /d "%BRIDGE_DIR%"
node pos-print-bridge.js
