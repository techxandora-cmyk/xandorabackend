-- Anomaly rules + detections + tag state cache

BEGIN;

CREATE TABLE IF NOT EXISTS anomaly_rules (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,            -- e.g., 'RAPID_EXIT', 'AFTER_HOURS', 'REAPPEAR', 'PING_PONG'
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomalies (
  id BIGSERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL REFERENCES anomaly_rules(code) ON DELETE RESTRICT,
  tag TEXT NOT NULL,
  device_id TEXT,
  antenna_role TEXT,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack','resolved'))
);

CREATE INDEX IF NOT EXISTS idx_anomalies_tag_time ON anomalies(tag, created_at DESC);

-- Fast in-memory-ish cache persisted in DB for last-known tag state
CREATE TABLE IF NOT EXISTS tag_state (
  tag TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_device_id TEXT,
  last_antenna_role TEXT,
  in_store BOOLEAN NOT NULL DEFAULT TRUE,
  last_event TEXT
);

-- Seed default rules (safe upserts)
INSERT INTO anomaly_rules (code, name, severity, config)
VALUES
  ('MANUAL','Manually reported anomaly','medium', '{}'),
  ('RAPID_EXIT','Rapid exit without aisle dwell','high', '{"maxSecondsSinceAisle":120}'),
  ('AFTER_HOURS','After-hours movement','medium', '{"storeOpen":"09:00","storeClose":"21:00","tz":"Asia/Colombo"}'),
  ('PING_PONG','Excessive gate bouncing','low', '{"windowSec":60,"maxBounces":4}'),
  ('REAPPEAR','Tag reappears after deactivation','medium', '{"minMinutes":10}')
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name, severity=EXCLUDED.severity, config=EXCLUDED.config, updated_at=now();

COMMIT;
