BEGIN;

CREATE TABLE IF NOT EXISTS company_products (
  company_name TEXT NOT NULL,
  product_key TEXT NOT NULL
    CHECK (product_key IN ('retail', 'laundry', 'jewellery')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_name, product_key)
);

CREATE INDEX IF NOT EXISTS idx_company_products_company
  ON company_products (company_name, is_enabled);

CREATE TABLE IF NOT EXISTS user_products (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL
    CHECK (product_key IN ('portal', 'retail', 'laundry', 'jewellery')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_user_products_product
  ON user_products (product_key, is_enabled);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'company_products_set_updated_at'
    ) THEN
      CREATE TRIGGER company_products_set_updated_at
      BEFORE UPDATE ON company_products
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'user_products_set_updated_at'
    ) THEN
      CREATE TRIGGER user_products_set_updated_at
      BEFORE UPDATE ON user_products
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END;
$$;

INSERT INTO company_products (company_name, product_key, is_enabled)
SELECT DISTINCT
  TRIM(u.company_name),
  'retail',
  TRUE
FROM users u
WHERE COALESCE(TRIM(u.company_name), '') <> ''
ON CONFLICT (company_name, product_key) DO NOTHING;

INSERT INTO user_products (user_id, product_key, is_enabled)
SELECT DISTINCT
  u.id,
  'retail',
  TRUE
FROM users u
WHERE COALESCE(TRIM(u.company_name), '') <> ''
ON CONFLICT (user_id, product_key) DO NOTHING;

INSERT INTO user_products (user_id, product_key, is_enabled)
SELECT DISTINCT
  usr.user_id,
  'portal',
  TRUE
FROM user_store_roles usr
WHERE UPPER(COALESCE(usr.role, '')) IN ('MASTER_ADMIN', 'ADMIN')
ON CONFLICT (user_id, product_key) DO NOTHING;

COMMIT;
