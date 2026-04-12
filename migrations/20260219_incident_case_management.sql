BEGIN;

CREATE TABLE IF NOT EXISTS alert_cases (
  id BIGSERIAL PRIMARY KEY,
  case_ref TEXT UNIQUE,
  alert_id BIGINT REFERENCES alerts(id) ON DELETE SET NULL,
  store_id VARCHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_user_id BIGINT,
  assigned_to_email TEXT,
  assigned_to_name TEXT,
  created_by_user_id BIGINT,
  created_by_email TEXT,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alert_cases
  ADD COLUMN IF NOT EXISTS case_ref TEXT;
ALTER TABLE alert_cases
  ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;
ALTER TABLE alert_cases
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_alert_cases_case_ref
  ON alert_cases (case_ref)
  WHERE case_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_cases_store_status_updated
  ON alert_cases (store_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_cases_alert_id
  ON alert_cases (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_cases_priority_status
  ON alert_cases (priority, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS alert_case_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES alert_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  note TEXT,
  actor_user_id BIGINT,
  actor_email TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alert_case_events
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_alert_case_events_case_id_created
  ON alert_case_events (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_case_events_event_type
  ON alert_case_events (event_type, created_at DESC);

COMMIT;
