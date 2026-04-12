# Xandora Staging and Hardware Validation

## Goal

Validate the live retail flow with real readers, real store scope, and real session handling before production deployment.

## Stage 1: Environment validation

1. Confirm `/api/health/live` returns `200`.
2. Confirm `/api/health/ready` returns `200`.
3. Confirm the dashboard can log in with:
   - master admin
   - customer admin
4. Confirm the correct store appears in the selector.

## Stage 2: Device validation

1. Register every fixed reader and handheld with the correct:
   - `device_id`
   - `device_type`
   - `store_id`
   - `location_label`
   - `zone_label`
2. Verify heartbeat updates on the Devices screen.
3. Power off one reader and confirm:
   - device status becomes offline
   - an offline alert appears
4. Reconnect the reader and confirm recovery.

## Stage 3: Scan quality validation

1. Scan a controlled set of tagged items.
2. Check that repeated reads are deduplicated cleanly.
3. Confirm read counts and last-seen values update.
4. Tune stability thresholds and RSSI filtering if noisy reads are present.

## Stage 4: Billing validation

1. Start a billing session.
2. Scan known in-catalog items.
3. Confirm matched status appears.
4. Scan:
   - an already billed EPC
   - a duplicate EPC
   - an unknown EPC
5. Confirm the correct validation status is shown in UI and API.
6. Complete the billing session and verify it appears in history.

## Stage 5: Inventory validation

1. Start an inventory session.
2. Scan a partial known set.
3. Confirm:
   - found count
   - missing count
   - accuracy percent
   - progress bar
4. End the session and confirm it appears in history.

## Stage 6: Alert validation

Trigger and verify:

- unknown EPC alert
- duplicate scan alert
- already billed alert
- missing expected items alert
- reader offline alert

## Stage 7: Sign-off

Capture:

- readiness response
- device list and health
- one completed billing session
- one completed inventory session
- alert screenshots
- any reader tuning values used in staging

Do not push to production until all seven stages pass with real hardware.
