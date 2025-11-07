-- 002_create_pos_and_tag_events.sql
-- Idempotent migration: create POS & events related tables and ensure tags columns exist
-- Uses information_schema checks to avoid ALTER ... IF NOT EXISTS compatibility issues.

-- tag_events
CREATE TABLE IF NOT EXISTS tag_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  epc VARCHAR(128) NOT NULL,
  event_type VARCHAR(64),
  source VARCHAR(64),
  data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (epc),
  INDEX (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- pos_transactions
CREATE TABLE IF NOT EXISTS pos_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pos_txn_id VARCHAR(128) NOT NULL UNIQUE,
  store_id VARCHAR(128),
  user_id VARCHAR(128),
  items JSON,
  total_amount DECIMAL(12,2) NULL,
  status VARCHAR(32) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- refund_audit
CREATE TABLE IF NOT EXISTS refund_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pos_txn_id VARCHAR(128),
  store_id VARCHAR(128),
  epcs_json JSON,
  total_amount DECIMAL(12,2),
  reason VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conditionally add columns to tags by checking information_schema and using dynamic SQL
-- sale_status
SET @exists := (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tags' AND COLUMN_NAME = 'sale_status'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE tags ADD COLUMN sale_status VARCHAR(32) DEFAULT 'AVAILABLE'",
  "SELECT 'sale_status already exists'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reserved_txn
SET @exists := (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tags' AND COLUMN_NAME = 'reserved_txn'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE tags ADD COLUMN reserved_txn VARCHAR(128) NULL",
  "SELECT 'reserved_txn already exists'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- updated_at column (if missing)
SET @exists := (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tags' AND COLUMN_NAME = 'updated_at'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE tags ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  "SELECT 'updated_at already exists'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
