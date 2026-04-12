DO $$
BEGIN
  IF to_regclass('public.company_products') IS NOT NULL THEN
    ALTER TABLE company_products
      DROP CONSTRAINT IF EXISTS company_products_product_key_check;

    DELETE FROM company_products old_row
    USING company_products new_row
    WHERE old_row.company_name = new_row.company_name
      AND old_row.product_key = 'jewellery'
      AND new_row.product_key = 'stock_audit';

    UPDATE company_products
    SET product_key = 'stock_audit'
    WHERE product_key IN ('jewellery', 'jewelry');

    ALTER TABLE company_products
      ADD CONSTRAINT company_products_product_key_check
      CHECK (product_key IN ('retail', 'laundry', 'stock_audit'));
  END IF;

  IF to_regclass('public.user_products') IS NOT NULL THEN
    ALTER TABLE user_products
      DROP CONSTRAINT IF EXISTS user_products_product_key_check;

    DELETE FROM user_products old_row
    USING user_products new_row
    WHERE old_row.user_id = new_row.user_id
      AND old_row.product_key = 'jewellery'
      AND new_row.product_key = 'stock_audit';

    UPDATE user_products
    SET product_key = 'stock_audit'
    WHERE product_key IN ('jewellery', 'jewelry');

    ALTER TABLE user_products
      ADD CONSTRAINT user_products_product_key_check
      CHECK (product_key IN ('portal', 'retail', 'laundry', 'stock_audit'));
  END IF;
END $$;
