BEGIN;

-- Alter check constraints to include stock_audit if not already present
DO $$
BEGIN
  -- company_products constraint
  ALTER TABLE company_products DROP CONSTRAINT IF EXISTS company_products_product_key_check;
  ALTER TABLE company_products ADD CONSTRAINT company_products_product_key_check
    CHECK (product_key IN ('retail', 'laundry', 'stock_audit'));
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

DO $$
BEGIN
  -- user_products constraint
  ALTER TABLE user_products DROP CONSTRAINT IF EXISTS user_products_product_key_check;
  ALTER TABLE user_products ADD CONSTRAINT user_products_product_key_check
    CHECK (product_key IN ('portal', 'retail', 'laundry', 'stock_audit'));
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

-- Enable laundry for every company that has retail
INSERT INTO company_products (company_name, product_key, is_enabled)
SELECT DISTINCT company_name, 'laundry', TRUE
FROM company_products
WHERE product_key = 'retail'
  AND is_enabled = TRUE
ON CONFLICT (company_name, product_key) DO UPDATE SET is_enabled = TRUE, updated_at = NOW();

-- Enable laundry for every user that has retail
INSERT INTO user_products (user_id, product_key, is_enabled)
SELECT DISTINCT user_id, 'laundry', TRUE
FROM user_products
WHERE product_key = 'retail'
  AND is_enabled = TRUE
ON CONFLICT (user_id, product_key) DO UPDATE SET is_enabled = TRUE, updated_at = NOW();

-- Enable stock_audit for every company that has retail
INSERT INTO company_products (company_name, product_key, is_enabled)
SELECT DISTINCT company_name, 'stock_audit', TRUE
FROM company_products
WHERE product_key = 'retail'
  AND is_enabled = TRUE
ON CONFLICT (company_name, product_key) DO UPDATE SET is_enabled = TRUE, updated_at = NOW();

-- Enable stock_audit for every user that has retail
INSERT INTO user_products (user_id, product_key, is_enabled)
SELECT DISTINCT user_id, 'stock_audit', TRUE
FROM user_products
WHERE product_key = 'retail'
  AND is_enabled = TRUE
ON CONFLICT (user_id, product_key) DO UPDATE SET is_enabled = TRUE, updated_at = NOW();

COMMIT;
