# Xandora Retail Console

RFID billing, inventory intake, and laundry console for customer showcases.

## Quick Start

```powershell
cd xandora-retail-console
npm install
npm start
```

Open:

`http://127.0.0.1:4300`

## Real Backend Mode

Use this when the retail console should write to and read from the main Xandora backend instead of the local demo JSON files.

Required environment variables:

- `RETAIL_REAL_MODE=1`
- `MAIN_API_URL=https://xandorabackend-44dt.onrender.com`

Example:

```powershell
$env:RETAIL_REAL_MODE="1"
$env:MAIN_API_URL="https://xandorabackend-44dt.onrender.com"
npm start
```

In real mode:

- users sign in with their own Xandora account at runtime
- users with access to multiple stores can choose their store after login
- manual assignment saves into the main backend catalog
- manual scans write into the main backend scan pipeline
- stocktake scans use the main backend stock-audit session APIs
- laundry actions use the main backend laundry APIs
- the console no longer uses `backend/data/products.json` as the source of truth

Deployment-day checklist:

- `docs/real-mode-deploy-checklist.md`

## Touch-Screen Launch (Windows)

- `launcher/Start-xandora-Retail-Console.bat`
- `launcher/Stop-xandora-Retail-Console.bat`

## Data Files

These files are used for demo mode only.

- `backend/data/products.json`
- `backend/data/epc_map.json`

Replace these with your customer's sample catalog before demos.

Fast replace command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-real-data.ps1 -ProductsFile C:\path\products.json -EpcMapFile C:\path\epc_map.json
```

`C:\path\...` is only an example. Use your actual file locations.

Then restart with:

```powershell
launcher\Stop-xandora-Retail-Console.bat
launcher\Start-xandora-Retail-Console.bat
```

## Notes

- This console is intentionally separate from production Xandora.
- Do not ship the real Xandora source for sales demos.
- Unknown EPCs scanned via the demo API are auto-mapped to a random product and saved to `backend/data/epc_map.json`.
- Reader integration endpoint: `POST /api/v1/scans/batch`
- Handheld stocktake endpoint: `POST /api/v1/handheld/stocktake/batch`
