BEGIN;

CREATE TABLE IF NOT EXISTS laundry_item_types (
  id BIGSERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'LINEN',
  max_wash_cycles INT NOT NULL DEFAULT 200,
  warning_cycle_threshold INT NOT NULL DEFAULT 180,
  notes TEXT,
  created_by_user_id BIGINT,
  created_by_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_name, code)
);

CREATE INDEX IF NOT EXISTS idx_laundry_item_types_company
  ON laundry_item_types (company_name, created_at DESC);

CREATE TABLE IF NOT EXISTS laundry_items (
  id BIGSERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  epc VARCHAR(255) NOT NULL,
  item_type_id BIGINT REFERENCES laundry_item_types(id) ON DELETE SET NULL,
  item_code TEXT,
  item_name TEXT NOT NULL,
  item_category TEXT NOT NULL DEFAULT 'LINEN',
  status TEXT NOT NULL DEFAULT 'IN_STOCK'
    CHECK (status IN ('IN_STOCK', 'OUT_WITH_CUSTOMER', 'IN_WASH', 'DAMAGED', 'LOST', 'RETIRED')),
  current_location TEXT,
  assigned_to TEXT,
  wash_cycle_count INT NOT NULL DEFAULT 0,
  max_wash_cycles INT NOT NULL DEFAULT 200,
  warning_cycle_threshold INT NOT NULL DEFAULT 180,
  retired_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id BIGINT,
  created_by_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_name, epc)
);

CREATE INDEX IF NOT EXISTS idx_laundry_items_company_store
  ON laundry_items (company_name, store_id, status, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_laundry_items_cycles
  ON laundry_items (company_name, wash_cycle_count DESC, max_wash_cycles DESC);

CREATE TABLE IF NOT EXISTS laundry_item_events (
  id BIGSERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  item_id BIGINT NOT NULL REFERENCES laundry_items(id) ON DELETE CASCADE,
  epc VARCHAR(255) NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  cycle_increment INT NOT NULL DEFAULT 0,
  wash_cycle_after INT NOT NULL DEFAULT 0,
  location_label TEXT,
  assigned_to TEXT,
  reference_no TEXT,
  notes TEXT,
  actor_user_id BIGINT,
  actor_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_laundry_item_events_store
  ON laundry_item_events (company_name, store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_laundry_item_events_item
  ON laundry_item_events (item_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'laundry_item_types_set_updated_at'
  ) THEN
    CREATE TRIGGER laundry_item_types_set_updated_at
    BEFORE UPDATE ON laundry_item_types
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'laundry_items_set_updated_at'
  ) THEN
    CREATE TRIGGER laundry_items_set_updated_at
    BEFORE UPDATE ON laundry_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

UPDATE role_permissions
SET
  permissions = COALESCE(permissions, '[]'::jsonb)
    || '["dashboard.view_laundry", "dashboard.manage_laundry"]'::jsonb,
  updated_at = NOW()
WHERE role IN ('ADMIN', 'STORE_MANAGER');

UPDATE role_permissions
SET
  permissions = COALESCE(permissions, '[]'::jsonb)
    || '["dashboard.view_laundry"]'::jsonb,
  updated_at = NOW()
WHERE role = 'STORE_STAFF';

UPDATE role_permissions
SET
  permissions = COALESCE(permissions, '[]'::jsonb)
    || '["handheld.laundry_scan"]'::jsonb,
  updated_at = NOW()
WHERE role = 'HANDHELD_USER';

INSERT INTO role_permissions (role, permissions)
VALUES (
  'HANDHELD_USER',
  '["handheld.scan_items", "handheld.inventory_count", "handheld.laundry_scan"]'::jsonb
)
ON CONFLICT (role) DO NOTHING;

COMMIT;
