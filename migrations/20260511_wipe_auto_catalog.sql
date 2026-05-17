BEGIN;

-- Remove all auto-generated placeholder catalog entries.
-- User will manually assign real products to EPCs via the Stock page.
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

TRUNCATE TABLE catalog_items RESTART IDENTITY CASCADE;

COMMIT;
