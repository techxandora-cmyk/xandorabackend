const fs = require("fs");
const path = require("path");

const MIGRATION_ORDER = [
  "000_create_tables_postgres.sql",
  "010_postgres_feature_tables.sql",
  "20251111_add_anomaly_rules.sql",
  "20260219_tag_registry_and_handheld_role.sql",
  "20260219_alerts_schema_compat.sql",
  "20260219_incident_case_management.sql",
  "20260223_users_updated_at_compat.sql",
  "20260329_laundry_module.sql",
  "20260329_laundry_fabrics_terminology.sql",
  "20260329_laundry_master_fields.sql",
  "20260329_product_access.sql",
  "20260329_stock_audit_rename.sql",
  "20260330_session_scan_hardening.sql",
  "20260424_enable_laundry_product.sql",
  "20260510_scan_tokens.sql",
  "20260510_force_password_change.sql",
  "20260510_cleanup_master_admin_store_roles.sql",
];

const CORE_READY_TABLES = [
  "users",
  "devices",
  "scan_batches",
  "scan_items",
  "inventory_sessions",
  "billing_sessions",
  "alerts",
];

function getMigrationsDir() {
  return path.resolve(__dirname, "..", "..", "migrations");
}

function listExpectedMigrations() {
  const migrationsDir = getMigrationsDir();
  const existing = fs.existsSync(migrationsDir)
    ? new Set(
        fs.readdirSync(migrationsDir).filter((file) => file.toLowerCase().endsWith(".sql"))
      )
    : new Set();

  return MIGRATION_ORDER.filter((filename) => existing.has(filename));
}

module.exports = {
  CORE_READY_TABLES,
  MIGRATION_ORDER,
  getMigrationsDir,
  listExpectedMigrations,
};
