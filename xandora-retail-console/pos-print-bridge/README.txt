Xandora POS Print Bridge

Use this on the POS machine that has the CP-Q1T receipt printer installed.

1. Make sure Node.js is installed.
2. Make sure the CP-Q1T Windows driver is installed.
3. If the printer name in Windows is not exactly CP-Q1T, edit Start-Xandora-Print-Bridge.bat:
   set "XANDORA_PRINTER_NAME=Your Printer Name"
4. Confirm the paper width matches the printer roll:
   set "XANDORA_PAPER_WIDTH_MM=80"
5. Run Start-Xandora-Print-Bridge.bat.
6. Test in a browser:
   http://127.0.0.1:4315/health
7. To auto-start with Windows, run Install-Startup-Shortcut.bat once.

The hosted retail console sends receipt jobs to:
http://127.0.0.1:4315/print-receipt

If the bridge is not running, the retail console falls back to the browser print flow.
The bridge now prints with an explicit receipt page size instead of generic Windows text printing.
