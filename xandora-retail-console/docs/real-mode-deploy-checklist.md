# Retail Console Real-Mode Deploy Checklist

Use this on deployment day for the hosted retail console that connects to the main Xandora backend.

## Current Expected Config

- Render service name: `xandora-retail-console`
- Render root dir: `xandora-retail-console`
- Render start command: `npm start`
- Retail console health check: `/api/health`
- Real-mode env flag: `RETAIL_REAL_MODE=1`
- Upstream backend URL: `MAIN_API_URL=https://xandorabackend-44dt.onrender.com`

## Before Deploying

1. Confirm `render.yaml` contains the retail console web service with:
   - `rootDir: xandora-retail-console`
   - `startCommand: npm start`
   - `healthCheckPath: /api/health`
   - `RETAIL_REAL_MODE=1`
   - `MAIN_API_URL=https://xandorabackend-44dt.onrender.com`
2. Confirm the retail console still passes local syntax checks:
   - `cd xandora-retail-console`
   - `npm run check`
3. Confirm the main backend code includes `POST /api/v1/catalog/upsert-item`.
4. Confirm you have at least one valid test account:
   - one account with access to exactly one store
   - one account with access to multiple stores
5. Confirm you have at least one real EPC available for each flow you want to demo:
   - billing or live scan
   - stocktake
   - laundry
   - manual assignment

## Deploy Order

1. Deploy the main backend first if it has not already been updated with `catalog/upsert-item`.
2. Wait for backend health to return `200` on:
   - `https://xandorabackend-44dt.onrender.com/api/health/live`
3. Deploy the retail console service.
4. Wait for retail console health to return `200` on:
   - `https://<retail-console-host>/api/health`

## Render Smoke Checks

1. Open the retail console URL in the browser.
2. Confirm the login modal appears immediately.
3. Confirm the page does not show the demo feed controls as active demo mode.
4. Confirm the health endpoint returns JSON with:
   - `ok: true`
   - `mode: "real"`
5. Confirm the simulator endpoints are not used in normal flow.

## Functional Test Flow

### 1. Login

1. Sign in with the single-store account.
2. Confirm login succeeds without a store-picker prompt.
3. Confirm the header shows:
   - signed-in user
   - selected store
4. Log out.

### 2. Multi-Store Selection

1. Sign in with the multi-store account.
2. Confirm the store selection prompt appears.
3. Pick a store.
4. Confirm the selected store appears in the header.

### 3. Live Session / Presence

1. Leave the console open after login.
2. Confirm no immediate auth loop or forced logout happens.
3. If a live reader is connected, confirm tags appear in the live or billing views.

### 4. Manual Assignment

1. Open the Assign Items view.
2. Enter a real EPC that is not yet mapped, or use a safe test EPC.
3. Fill in:
   - product name
   - SKU
   - category
   - price
   - stock
   - laundry status
   - bin
4. Save the assignment.
5. Confirm the UI reports success.
6. Refresh the assignments list.
7. Confirm the saved item is still present.

### 5. Stocktake

1. Go to Inventory.
2. Use `Scan to Inventory` with a known EPC.
3. Confirm the recent stocktake table updates.
4. Confirm counts increase.
5. If the account lacks `stock_audit`, confirm the UI disables this path cleanly.

### 6. Laundry

1. Go to Laundry.
2. Use a known EPC and apply a status change.
3. Confirm the item appears in the laundry table.
4. Confirm the selected status is reflected.
5. If the account lacks `laundry`, confirm the UI hides or disables laundry cleanly.

### 7. Billing / Cart

1. Add a known EPC into the live or billing flow.
2. Confirm it can be added to the cart.
3. Remove it again.
4. Confirm cart totals update correctly.

## Fast Failure Checks

If something breaks, check these first:

1. `GET /api/health` on the retail console:
   - if `mode` is not `real`, the env flags are wrong
2. Browser login loop:
   - session header or session restore issue
3. Assignment save fails:
   - missing backend route `POST /api/v1/catalog/upsert-item`
   - auth token lacks store access
4. Stocktake fails:
   - account does not have `stock_audit`
5. Laundry fails:
   - account does not have `laundry`
6. Retail console cannot reach backend:
   - wrong `MAIN_API_URL`
   - backend unhealthy

## Suggested Tomorrow Sequence

1. Run `npm run check` in `xandora-retail-console`.
2. Verify backend health.
3. Verify retail console health.
4. Test single-store login.
5. Test multi-store login.
6. Test one manual assignment.
7. Test one stocktake scan.
8. Test one laundry action.
9. Leave the console open for a few minutes and confirm the session stays stable.

## Status Call

You can call the build ready for tomorrow only after all of these are true:

- retail console health is green
- login works
- store selection works
- assignment save works
- stocktake works for an enabled account
- laundry works for an enabled account
- no auth loop or immediate session expiry appears
