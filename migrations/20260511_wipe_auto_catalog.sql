BEGIN;

-- Remove all auto-generated placeholder catalog entries.
-- User will manually assign real products to EPCs via the Stock page.
TRUNCATE TABLE catalog_items RESTART IDENTITY CASCADE;

COMMIT;
