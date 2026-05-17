BEGIN;

-- ============================================================
-- scan_tokens: per-company and per-store reader auth tokens
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS scan_tokens_id_seq;

CREATE TABLE IF NOT EXISTS scan_tokens (
  id            BIGINT       PRIMARY KEY DEFAULT nextval('scan_tokens_id_seq'),
  token         TEXT         NOT NULL UNIQUE,
  token_type    TEXT         NOT NULL CHECK (token_type IN ('company', 'store')),
  company_name  TEXT         NOT NULL,
  store_id      TEXT,
  label         TEXT         NOT NULL DEFAULT '',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER SEQUENCE scan_tokens_id_seq OWNED BY scan_tokens.id;

CREATE INDEX IF NOT EXISTS idx_scan_tokens_token   ON scan_tokens(token);
CREATE INDEX IF NOT EXISTS idx_scan_tokens_company ON scan_tokens(company_name);
CREATE INDEX IF NOT EXISTS idx_scan_tokens_active  ON scan_tokens(is_active);

-- Only one active store token per (company, store)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_tokens_unique_active_store
  ON scan_tokens(company_name, store_id)
  WHERE token_type = 'store' AND is_active = TRUE AND store_id IS NOT NULL;

-- Only one active company token per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_tokens_unique_active_company
  ON scan_tokens(company_name)
  WHERE token_type = 'company' AND is_active = TRUE;

-- ============================================================
-- registered_readers: reader IP + zone config per store
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS registered_readers_id_seq;

CREATE TABLE IF NOT EXISTS registered_readers (
  id             BIGINT       PRIMARY KEY DEFAULT nextval('registered_readers_id_seq'),
  store_token_id BIGINT       NOT NULL REFERENCES scan_tokens(id) ON DELETE CASCADE,
  company_name   TEXT         NOT NULL,
  store_id       TEXT         NOT NULL,
  device_id      TEXT         NOT NULL,
  reader_ip      TEXT         NOT NULL,
  reader_name    TEXT         NOT NULL DEFAULT '',
  zone_id        TEXT         NOT NULL DEFAULT 'sales_floor',
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, reader_ip)
);

ALTER SEQUENCE registered_readers_id_seq OWNED BY registered_readers.id;

CREATE INDEX IF NOT EXISTS idx_registered_readers_token  ON registered_readers(store_token_id);
CREATE INDEX IF NOT EXISTS idx_registered_readers_store  ON registered_readers(store_id);
CREATE INDEX IF NOT EXISTS idx_registered_readers_active ON registered_readers(is_active);

-- ============================================================
-- Backfill store tokens for existing company_stores
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS company_stores_id_seq;

CREATE TABLE IF NOT EXISTS company_stores (
  id BIGINT PRIMARY KEY DEFAULT nextval('company_stores_id_seq'::regclass),
  company_name TEXT NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  store_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_name, store_id)
);

ALTER SEQUENCE company_stores_id_seq OWNED BY company_stores.id;

CREATE INDEX IF NOT EXISTS idx_company_stores_company_name
  ON company_stores (company_name);

CREATE INDEX IF NOT EXISTS idx_company_stores_is_active
  ON company_stores (is_active);

INSERT INTO scan_tokens (token, token_type, company_name, store_id, label)
SELECT
  'st_' || replace(gen_random_uuid()::text, '-', ''),
  'store',
  cs.company_name,
  cs.store_id,
  COALESCE(NULLIF(cs.store_name, ''), cs.store_id)
FROM company_stores cs
WHERE cs.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM scan_tokens t
    WHERE t.token_type = 'store'
      AND t.company_name = cs.company_name
      AND t.store_id = cs.store_id
      AND t.is_active = TRUE
  );

-- Backfill company tokens for distinct companies
INSERT INTO scan_tokens (token, token_type, company_name, store_id, label)
SELECT DISTINCT ON (cs.company_name)
  'ct_' || replace(gen_random_uuid()::text, '-', ''),
  'company',
  cs.company_name,
  NULL,
  cs.company_name
FROM company_stores cs
WHERE cs.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM scan_tokens t
    WHERE t.token_type = 'company'
      AND t.company_name = cs.company_name
      AND t.is_active = TRUE
  );

COMMIT;
