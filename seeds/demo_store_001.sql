BEGIN;

/* ===============================
   STORE
================================ */
INSERT INTO stores (store_id, name)
VALUES ('STORE_001', 'Demo Store 001')
ON CONFLICT (store_id) DO NOTHING;

/* ===============================
   DEVICES
================================ */
INSERT INTO devices (device_id, store_id, status, last_seen)
VALUES
  ('DEV_READER_01', 'STORE_001', 'online', NOW()),
  ('DEV_READER_02', 'STORE_001', 'offline', NOW() - INTERVAL '2 hours'),
  ('HANDHELD_01',   'STORE_001', 'online', NOW())
ON CONFLICT (device_id) DO NOTHING;

/* ===============================
   INVENTORY TAGS
================================ */
INSERT INTO inventory_tags (epc, store_id, created_at, last_seen)
VALUES
  ('EPC_0001', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0002', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0003', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0004', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0005', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0006', 'STORE_001', NOW() - INTERVAL '2 days', NOW()),
  ('EPC_0007', 'STORE_001', NOW() - INTERVAL '2 days', NOW() - INTERVAL '20 hours'),
  ('EPC_0008', 'STORE_001', NOW() - INTERVAL '2 days', NOW() - INTERVAL '23 hours'),
  ('EPC_0009', 'STORE_001', NOW() - INTERVAL '2 days', NULL),
  ('EPC_0010', 'STORE_001', NOW() - INTERVAL '2 days', NULL)
ON CONFLICT (epc) DO NOTHING;

/* ===============================
   POS TRANSACTIONS
================================ */
INSERT INTO pos_transactions
(ext_id, store_id, total_items, total_amount, created_at)
VALUES
  ('POS_TXN_001', 'STORE_001', 2, 3500.00, NOW() - INTERVAL '1 hour'),
  ('POS_TXN_002', 'STORE_001', 3, 4200.00, NOW() - INTERVAL '30 minutes')
ON CONFLICT (ext_id) DO NOTHING;

/* ===============================
   ALERTS
================================ */
INSERT INTO alerts
(store_id, severity, message, status, created_at)
VALUES
  ('STORE_001', 'warning',  'Inventory variance detected', 'open', NOW() - INTERVAL '40 minutes'),
  ('STORE_001', 'critical', 'Device DEV_READER_02 offline', 'open', NOW() - INTERVAL '20 minutes');

COMMIT;
