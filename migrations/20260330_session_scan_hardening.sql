BEGIN;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'FIXED_READER',
  ADD COLUMN IF NOT EXISTS location_label TEXT,
  ADD COLUMN IF NOT EXISTS zone_label TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_error TEXT;

UPDATE devices
SET
  device_type = COALESCE(NULLIF(device_type, ''), 'FIXED_READER'),
  last_heartbeat = COALESCE(last_heartbeat, last_seen)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_devices_last_heartbeat
  ON devices (last_heartbeat DESC);

ALTER TABLE scan_batches
  ADD COLUMN IF NOT EXISTS received_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_epc_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS noisy_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE scan_items
  ADD COLUMN IF NOT EXISTS read_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS metrics_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE scan_items
SET
  read_count = COALESCE(read_count, 1),
  first_seen = COALESCE(first_seen, ts),
  last_seen = COALESCE(last_seen, ts),
  processing_status = COALESCE(NULLIF(processing_status, ''), 'CONFIRMED'),
  metrics_summary = COALESCE(metrics_summary, '{}'::jsonb)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_scan_items_store_last_seen
  ON scan_items (store_id, COALESCE(last_seen, ts) DESC);

ALTER TABLE inventory_sessions DROP CONSTRAINT IF EXISTS inventory_sessions_status_check;
ALTER TABLE inventory_sessions
  ADD CONSTRAINT inventory_sessions_status_check
  CHECK (status IN ('ACTIVE', 'COMPLETED', 'ENDED', 'CANCELLED'));

ALTER TABLE inventory_sessions
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(48),
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS operator_label TEXT,
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'AUDIT',
  ADD COLUMN IF NOT EXISTS metrics_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE inventory_sessions
SET
  session_id = COALESCE(session_id, 'AUD-' || id::text),
  session_type = COALESCE(NULLIF(session_type, ''), 'AUDIT'),
  created_by_email = COALESCE(created_by_email, operator_label),
  metrics_summary = COALESCE(metrics_summary, '{}'::jsonb)
WHERE TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_sessions_session_id
  ON inventory_sessions (session_id);

ALTER TABLE inventory_scans
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE billing_sessions
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(48),
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS operator_label TEXT,
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'BILLING',
  ADD COLUMN IF NOT EXISTS metrics_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE billing_sessions
SET
  session_id = COALESCE(session_id, 'BILL-' || id::text),
  created_by_email = COALESCE(created_by_email, operator_label),
  session_type = COALESCE(NULLIF(session_type, ''), 'BILLING'),
  metrics_summary = COALESCE(metrics_summary, '{}'::jsonb)
WHERE TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_sessions_session_id
  ON billing_sessions (session_id);

ALTER TABLE billing_session_scans
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'MATCHED',
  ADD COLUMN IF NOT EXISTS validation_message TEXT,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS price_lkr NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_validation_at TIMESTAMPTZ;

UPDATE billing_session_scans
SET
  validation_status = COALESCE(NULLIF(validation_status, ''), 'MATCHED'),
  metadata = COALESCE(metadata, '{}'::jsonb),
  last_validation_at = COALESCE(last_validation_at, last_seen, first_seen)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_billing_session_scans_validation_status
  ON billing_session_scans (validation_status);

CREATE TABLE IF NOT EXISTS scan_epc_state (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(128) NOT NULL,
  store_id VARCHAR(64) NOT NULL DEFAULT '_NO_STORE_',
  epc VARCHAR(255) NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_count INT NOT NULL DEFAULT 0,
  confirmed_count INT NOT NULL DEFAULT 0,
  strongest_rssi INT,
  average_rssi NUMERIC(10,2),
  last_confirmed_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'PENDING',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_scan_epc_state_device_store_epc
  ON scan_epc_state (device_id, store_id, epc);

CREATE INDEX IF NOT EXISTS idx_scan_epc_state_store_status
  ON scan_epc_state (store_id, last_status, last_seen_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'scan_epc_state_set_updated_at'
  ) THEN
    CREATE TRIGGER scan_epc_state_set_updated_at
    BEFORE UPDATE ON scan_epc_state
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
