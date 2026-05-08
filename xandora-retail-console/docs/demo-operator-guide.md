# Xandora Retail Console Operator Guide

## Purpose

This is a retail console build for showcasing Xandora POS, inventory, and laundry behavior.
It is not the production Xandora stack.

## What This Console Includes

- Live scan zone with auto-disappear when tags are no longer seen.
- POS cart operations (add/remove/clear).
- Inventory snapshot with in-zone visibility.
- Static preloaded EPC and product data.
- Auto-assignment for unknown EPCs (random product profile, persisted for repeat scans).

## Prerequisites (Windows Demo Machine)

- Node.js 20+ installed.
- Internet only needed once for first `npm install`.
- Microsoft Edge or Google Chrome.

## One-Touch Start

Double-click:

`xandora-retail-console/launcher/Start-Xandora-Retail-Console.bat`

What happens:

1. Installs dependencies (first run only).
2. Starts the local demo server.
3. Opens browser in full-screen kiosk mode.

## Stop Console

Double-click:

`xandora-retail-console/launcher/Stop-Xandora-Retail-Console.bat`

If startup fails, check:

- `xandora-retail-console/.demo-server.out.log`
- `xandora-retail-console/.demo-server.err.log`

## Replace Demo Data

Edit these files:

- `xandora-retail-console/backend/data/products.json`
- `xandora-retail-console/backend/data/epc_map.json`

Then restart the console with `Start-Xandora-Retail-Console.bat`.

Or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-real-data.ps1 -ProductsFile C:\path\products.json -EpcMapFile C:\path\epc_map.json
```

`C:\path\...` is an example path. Replace with your real files.

## Close Button

- The top-right `Close` button requests clean shutdown from inside the UI.
- You can also use `Stop-Xandora-Retail-Console.bat` externally.

## Manual API Checks

- Health: `http://127.0.0.1:4300/api/health`
- Live in-zone: `http://127.0.0.1:4300/api/live/in-zone`
- Inventory: `http://127.0.0.1:4300/api/inventory/summary`

## Hardware Ingestion Endpoints

Use these when real hardware is connected to the POS machine:

- Fixed reader (POS zone): `POST /api/v1/scans/batch`
- Handheld (stocktake): `POST /api/v1/handheld/stocktake/batch`

Batch payload format:

```json
{
  "device_id": "FX9600_01",
  "store_id": "STORE_001",
  "items": [
    { "tag": "E28011700000000000000001" },
    { "tag": "E28011700000000000000002" }
  ]
}
```

Handheld payload can use `epc` fields and stocktake hints:

```json
{
  "device_id": "ZEBRA_RFD90",
  "store_id": "STORE_001",
  "source": "handheld",
  "mode": "stocktake",
  "items": [
    { "epc": "E28011700000000000000003" },
    { "epc": "E28011700000000000000004" }
  ]
}
```

## Notes

- This demo can be inspected if copied to a third-party machine.
- Keep your full Xandora production codebase separate.
