-- Remove store-specific role assignments from MASTER_ADMIN users.
-- Master admins access all customer stores via the company switcher; they don't
-- need (and shouldn't have) individual store rows in user_store_roles.
DELETE FROM user_store_roles
WHERE user_id IN (
  SELECT DISTINCT user_id FROM user_store_roles WHERE role = 'MASTER_ADMIN'
)
AND role != 'MASTER_ADMIN';
