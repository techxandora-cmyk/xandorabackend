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
