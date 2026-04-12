-- 000_create_tables_postgres.sql
-- Postgres version of middleware_db base schema

BEGIN;

-- ============================
-- DEVICES
-- ============================

CREATE TABLE IF NOT EXISTS devices (
  id          BIGSERIAL PRIMARY KEY,
  device_id   VARCHAR(128) NOT NULL UNIQUE,
  name        VARCHAR(255),
  store_id    VARCHAR(64),
  status      TEXT NOT NULL DEFAULT 'unknown'
              CHECK (status IN ('online','offline','unknown')),
  last_seen   TIMESTAMPTZ,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_store
  ON devices (store_id);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen
  ON devices (last_seen);

-- ============================
-- SCAN BATCHES
-- ============================

CREATE TABLE IF NOT EXISTS scan_batches (
  id         BIGSERIAL PRIMARY KEY,
  device_id  VARCHAR(128) NOT NULL,
  store_id   VARCHAR(64),
  ext_id     VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata   JSONB
);

CREATE INDEX IF NOT EXISTS idx_scan_batches_device
  ON scan_batches (device_id);

CREATE INDEX IF NOT EXISTS idx_scan_batches_ext
  ON scan_batches (ext_id);

-- ============================
-- SCAN ITEMS
-- ============================

CREATE TABLE IF NOT EXISTS scan_items (
  id         BIGSERIAL PRIMARY KEY,
  batch_id   BIGINT REFERENCES scan_batches(id) ON DELETE SET NULL,
  device_id  VARCHAR(128) NOT NULL,
  tag        VARCHAR(255) NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,          -- timestamp of scan
  store_id   VARCHAR(64),
  raw        JSONB,
  rssi       INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same unique key as MySQL: (device_id, tag, ts)
CREATE UNIQUE INDEX IF NOT EXISTS ux_scan_unique
  ON scan_items (device_id, tag, ts);

CREATE INDEX IF NOT EXISTS idx_scan_items_tag
  ON scan_items (tag);

CREATE INDEX IF NOT EXISTS idx_scan_items_device
  ON scan_items (device_id);

CREATE INDEX IF NOT EXISTS idx_scan_items_ts
  ON scan_items (ts DESC);

-- ============================
-- POS TRANSACTIONS
-- ============================

CREATE TABLE IF NOT EXISTS pos_transactions (
  id           BIGSERIAL PRIMARY KEY,
  ext_id       VARCHAR(128),
  total_amount NUMERIC(14,2) DEFAULT 0,
  total_items  INT DEFAULT 0,
  store_id     VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB
);

CREATE INDEX IF NOT EXISTS idx_pos_ext
  ON pos_transactions (ext_id);

-- ============================
-- TAGS
-- ============================

CREATE TABLE IF NOT EXISTS tags (
  id         BIGSERIAL PRIMARY KEY,
  epc        VARCHAR(255) NOT NULL UNIQUE,
  last_seen  TIMESTAMPTZ,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- TAG EVENTS
-- ============================

CREATE TABLE IF NOT EXISTS tag_events (
  id         BIGSERIAL PRIMARY KEY,
  epc        VARCHAR(255) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  source     VARCHAR(128),
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_events_epc
  ON tag_events (epc);

CREATE INDEX IF NOT EXISTS idx_tag_events_type
  ON tag_events (event_type);

-- ============================
-- UPDATED_AT TRIGGER (for tables that have updated_at)
-- ============================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'devices_set_updated_at'
  ) THEN
    CREATE TRIGGER devices_set_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'scan_items_set_updated_at'
  ) THEN
    CREATE TRIGGER scan_items_set_updated_at
    BEFORE UPDATE ON scan_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tags_set_updated_at'
  ) THEN
    CREATE TRIGGER tags_set_updated_at
    BEFORE UPDATE ON tags
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
