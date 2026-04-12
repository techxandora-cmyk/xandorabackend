BEGIN;

CREATE TABLE IF NOT EXISTS tag_registry (
  id BIGSERIAL PRIMARY KEY,
  internal_uid UUID NOT NULL UNIQUE,
  epc VARCHAR(255) NOT NULL,
  tid VARCHAR(255),
  store_id VARCHAR(64),
  company_name TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  duplicate_of_internal_uid UUID,
  created_by_user_id BIGINT,
  created_by_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_registry_epc
  ON tag_registry (epc);

CREATE INDEX IF NOT EXISTS idx_tag_registry_tid
  ON tag_registry (tid);

CREATE INDEX IF NOT EXISTS idx_tag_registry_store
  ON tag_registry (store_id);

CREATE INDEX IF NOT EXISTS idx_tag_registry_created
  ON tag_registry (created_at DESC);

INSERT INTO role_permissions (role, permissions)
VALUES (
  'HANDHELD_USER',
  '[
    "handheld.scan_items",
    "handheld.inventory_count"
  ]'::jsonb
)
ON CONFLICT (role) DO NOTHING;

COMMIT;
