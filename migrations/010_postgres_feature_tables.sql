BEGIN;

-- ============================
-- USERS / RBAC
-- ============================

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  company_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_store_roles (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   VARCHAR(64) NOT NULL,
  role       VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, store_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_store_roles_user_id
  ON user_store_roles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_store_roles_store_id
  ON user_store_roles (store_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions_company (
  company_name TEXT NOT NULL,
  role         TEXT NOT NULL,
  permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_name, role)
);

INSERT INTO role_permissions (role, permissions)
VALUES
  (
    'ADMIN',
    '[
      "dashboard.view_overview",
      "dashboard.view_pos",
      "dashboard.view_billing",
      "dashboard.view_recent_scans",
      "dashboard.view_devices",
      "dashboard.view_inventory",
      "dashboard.view_stock",
      "dashboard.view_alerts",
      "dashboard.manage_users",
      "dashboard.manage_roles",
      "dashboard.view_audit_logs"
    ]'::jsonb
  ),
  (
    'STORE_MANAGER',
    '[
      "dashboard.view_overview",
      "dashboard.view_pos",
      "dashboard.view_billing",
      "dashboard.view_recent_scans",
      "dashboard.view_devices",
      "dashboard.view_inventory",
      "dashboard.view_stock",
      "dashboard.view_alerts",
      "handheld.scan_items",
      "handheld.inventory_count"
    ]'::jsonb
  ),
  (
    'STORE_STAFF',
    '[
      "dashboard.view_overview",
      "dashboard.view_pos",
      "dashboard.view_recent_scans",
      "dashboard.view_devices",
      "handheld.scan_items"
    ]'::jsonb
  )
ON CONFLICT (role) DO NOTHING;

-- ============================
-- POS EXTENSIONS
-- ============================

CREATE TABLE IF NOT EXISTS pos_transaction_items (
  id         BIGSERIAL PRIMARY KEY,
  pos_txn_id BIGINT NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
  epc        VARCHAR(255) NOT NULL,
  price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_txn_items_txn
  ON pos_transaction_items (pos_txn_id);

CREATE INDEX IF NOT EXISTS idx_pos_txn_items_epc
  ON pos_transaction_items (epc);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_transactions_ext_id
  ON pos_transactions (ext_id)
  WHERE ext_id IS NOT NULL;

-- ============================
-- INVENTORY
-- ============================

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id               BIGSERIAL PRIMARY KEY,
  store_id         VARCHAR(64) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  total_expected   INT NOT NULL DEFAULT 0,
  total_found      INT NOT NULL DEFAULT 0,
  total_missing    INT NOT NULL DEFAULT 0,
  accuracy_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_store_status
  ON inventory_sessions (store_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS inventory_scans (
  id         BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  epc        VARCHAR(255) NOT NULL,
  read_count INT NOT NULL DEFAULT 1,
  device_id  VARCHAR(128),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  store_id   VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, epc)
);

CREATE INDEX IF NOT EXISTS idx_inventory_scans_session
  ON inventory_scans (session_id, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_scans_store_epc
  ON inventory_scans (store_id, epc);

-- ============================
-- BILLING SESSIONS
-- ============================

CREATE TABLE IF NOT EXISTS billing_sessions (
  id                   BIGSERIAL PRIMARY KEY,
  store_id             VARCHAR(64) NOT NULL,
  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  expected_items_count INT NOT NULL DEFAULT 0,
  scanned_items_count  INT NOT NULL DEFAULT 0,
  created_by_email     TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_sessions_store_status
  ON billing_sessions (store_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS billing_session_scans (
  id         BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES billing_sessions(id) ON DELETE CASCADE,
  epc        VARCHAR(255) NOT NULL,
  device_id  VARCHAR(128),
  read_count INT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, epc)
);

CREATE INDEX IF NOT EXISTS idx_billing_session_scans_session
  ON billing_session_scans (session_id, last_seen DESC);

-- ============================
-- ALERTS
-- ============================

CREATE TABLE IF NOT EXISTS alerts (
  id                BIGSERIAL PRIMARY KEY,
  type              TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  store_id          VARCHAR(64),
  severity          INT NOT NULL DEFAULT 50,
  status            TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'RESOLVED')),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_store_status_last_seen
  ON alerts (store_id, status, last_detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_type_status
  ON alerts (type, status);

-- ============================
-- UPDATED_AT TRIGGERS
-- ============================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_set_updated_at') THEN
    CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_permissions_set_updated_at') THEN
    CREATE TRIGGER role_permissions_set_updated_at
    BEFORE UPDATE ON role_permissions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_permissions_company_set_updated_at') THEN
    CREATE TRIGGER role_permissions_company_set_updated_at
    BEFORE UPDATE ON role_permissions_company
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_sessions_set_updated_at') THEN
    CREATE TRIGGER inventory_sessions_set_updated_at
    BEFORE UPDATE ON inventory_sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_scans_set_updated_at') THEN
    CREATE TRIGGER inventory_scans_set_updated_at
    BEFORE UPDATE ON inventory_scans
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'billing_sessions_set_updated_at') THEN
    CREATE TRIGGER billing_sessions_set_updated_at
    BEFORE UPDATE ON billing_sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'billing_session_scans_set_updated_at') THEN
    CREATE TRIGGER billing_session_scans_set_updated_at
    BEFORE UPDATE ON billing_session_scans
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'alerts_set_updated_at') THEN
    CREATE TRIGGER alerts_set_updated_at
    BEFORE UPDATE ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
