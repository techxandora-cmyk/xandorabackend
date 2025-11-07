CREATE TABLE IF NOT EXISTS security_alerts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reader_id VARCHAR(128),
  location_id VARCHAR(128),
  timestamp DATETIME,
  offenders JSON,
  acknowledged TINYINT(1) DEFAULT 0,
  acknowledged_by VARCHAR(128) DEFAULT NULL,
  acknowledged_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
