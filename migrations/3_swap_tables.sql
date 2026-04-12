-- 3_swap_tables.sql
-- Swap old devices with devices_new (keeps devices_old as backup)
RENAME TABLE devices TO devices_old, devices_new TO devices;
