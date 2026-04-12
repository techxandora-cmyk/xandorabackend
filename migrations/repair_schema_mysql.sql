-- ============================
-- FIX DEVICES TABLE
-- ============================
ALTER TABLE devices
  CHANGE COLUMN id id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD COLUMN device_id VARCHAR(128) NULL AFTER id,
  ADD COLUMN status ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown' AFTER store_id,
  ADD COLUMN metadata JSON NULL AFTER status;

-- Add unique constraint for device_id
ALTER TABLE devices
  ADD UNIQUE KEY ux_devices_device_id (device_id);

-- Remove old columns if you want (optional)
-- ALTER TABLE devices DROP COLUMN token;
-- ALTER TABLE devices DROP COLUMN active;


-- ============================
-- FIX SCAN_ITEMS TABLE
-- ============================
ALTER TABLE scan_items
  ADD COLUMN raw JSON NULL AFTER ts,
  ADD COLUMN rssi INT NULL AFTER raw,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP 
    ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- Add dedupe index
ALTER TABLE scan_items
  ADD UNIQUE KEY ux_scan_unique (device_id, tag, ts);
