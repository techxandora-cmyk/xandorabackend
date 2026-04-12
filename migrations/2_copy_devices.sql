-- 2_copy_devices.sql
-- Copy old devices.id (string) -> devices_new.device_id
INSERT INTO devices_new (device_id, name, store_id, token, active, last_seen, created_at, updated_at)
SELECT id AS device_id, name, store_id, token, active, last_seen, created_at, updated_at
FROM devices
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  store_id = VALUES(store_id),
  token = VALUES(token),
  active = VALUES(active),
  last_seen = VALUES(last_seen),
  updated_at = VALUES(updated_at);
