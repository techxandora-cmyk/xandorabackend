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

## Touch-Screen Launch (Windows)

- `launcher/Start-Xandora-Retail-Console.bat`
- `launcher/Stop-Xandora-Retail-Console.bat`

## Data Files

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
launcher\Stop-Xandora-Retail-Console.bat
launcher\Start-Xandora-Retail-Console.bat
```

## Notes

- This console is intentionally separate from production Xandora.
- Do not ship the real Xandora source for sales demos.
- Unknown EPCs scanned via the demo API are auto-mapped to a random product and saved to `backend/data/epc_map.json`.
- Reader integration endpoint: `POST /api/v1/scans/batch`
- Handheld stocktake endpoint: `POST /api/v1/handheld/stocktake/batch`
