BEGIN;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alerts_store_status_last_seen
  ON alerts (store_id, status, last_detected_at DESC);

COMMIT;
