BEGIN;

-- ============================================================
-- Clear all operational / demo data.
-- Preserves: users, company_stores, devices, scan_tokens,
--            registered_readers, role/permission tables,
--            schema_migrations, laundry_item_types.
-- Wipes:     every scan, tag, catalog, session, alert, and
--            laundry operational row so the system starts
--            fresh for live data.
-- ============================================================

CREATE TABLE IF NOT EXISTS catalog_items (
  id           BIGSERIAL PRIMARY KEY,
  store_id     VARCHAR(64) NOT NULL,
  epc          VARCHAR(255) NOT NULL,
  sku          VARCHAR(64),
  product_name VARCHAR(255) NOT NULL,
  brand        VARCHAR(128),
  category     VARCHAR(64),
  size_label   VARCHAR(32),
  color        VARCHAR(64),
  price_lkr    NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, epc)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_store
  ON catalog_items (store_id);

CREATE INDEX IF NOT EXISTS idx_catalog_items_epc
  ON catalog_items (epc);

-- Tag tracking & EPC state
TRUNCATE TABLE scan_epc_state       RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag_registry         RESTART IDENTITY CASCADE;

-- Scan data
TRUNCATE TABLE scan_items           RESTART IDENTITY CASCADE;
TRUNCATE TABLE scan_batches         RESTART IDENTITY CASCADE;

-- Inventory & billing sessions
TRUNCATE TABLE inventory_scans      RESTART IDENTITY CASCADE;
TRUNCATE TABLE inventory_sessions   RESTART IDENTITY CASCADE;
TRUNCATE TABLE billing_session_scans RESTART IDENTITY CASCADE;
TRUNCATE TABLE billing_sessions     RESTART IDENTITY CASCADE;

-- POS transactions
TRUNCATE TABLE pos_transaction_items RESTART IDENTITY CASCADE;
TRUNCATE TABLE pos_transactions     RESTART IDENTITY CASCADE;

-- Alerts & cases
TRUNCATE TABLE alert_case_events    RESTART IDENTITY CASCADE;
TRUNCATE TABLE alert_cases          RESTART IDENTITY CASCADE;
TRUNCATE TABLE alerts               RESTART IDENTITY CASCADE;

-- Laundry operational rows (keep item_types as config)
TRUNCATE TABLE laundry_item_events  RESTART IDENTITY CASCADE;
TRUNCATE TABLE laundry_items        RESTART IDENTITY CASCADE;

-- Catalog (auto-generated from demo scans)
TRUNCATE TABLE catalog_items        RESTART IDENTITY CASCADE;

COMMIT;
