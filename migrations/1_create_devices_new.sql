-- 1_create_devices_new.sql
-- Creates new devices table with correct schema

CREATE TABLE IF NOT EXISTS devices_new (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) DEFAULT NULL,
  store_id VARCHAR(64) DEFAULT NULL,
  token VARCHAR(128) DEFAULT NULL,         -- keep existing token column
  active TINYINT(1) DEFAULT 1,             -- preserve active flag
  status ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown',
  last_seen DATETIME DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY ux_devices_device_id (device_id),
  INDEX idx_devices_store (store_id),
  INDEX idx_devices_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
