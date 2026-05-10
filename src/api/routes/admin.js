// src/api/routes/admin.js
const { Router } = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
  SOFTWARE_CATALOG,
  COMPANY_ASSIGNABLE_PRODUCTS,
  ensureProductAccessTables,
  getEnabledCompanyProducts,
  getEnabledUserProductMap,
  normalizeProductKeys,
  replaceCompanyProducts,
  replaceUserProducts,
} = require("./lib/productAccess");

let clearRecentEvents = () => 0;
try {
  const eventsModule = require("./events");
  if (typeof eventsModule?.clearRecentEvents === "function") {
    clearRecentEvents = eventsModule.clearRecentEvents;
  }
} catch {}

const { generateStoreToken, generateCompanyToken } = require("./lib/scanTokens");

module.exports = function buildAdminRoutes(pool) {
  const router = Router();
  const USER_MANAGED_ROLES = new Set([
    "ADMIN",
    "STORE_MANAGER",
    "STORE_STAFF",
    "HANDHELD_USER",
  ]);
  const GLOBAL_ROLES = new Set(["ADMIN"]);
  const PROTECTED_EMAILS = new Set(["admin@Xandora.local"]);

  function normalizeStoreIds(rawStoreIds) {
    if (!Array.isArray(rawStoreIds)) return [];

    return Array.from(
      new Set(
        rawStoreIds
          .map((storeId) => String(storeId || "").trim())
          .filter((storeId) => Boolean(storeId) && storeId !== "_GLOBAL_")
      )
    );
  }

  function buildSeedStoreId(companyName) {
    const slug = String(companyName || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return slug ? `${slug}_001` : "";
  }

  function normalizeStoreId(rawStoreId) {
    return String(rawStoreId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function normalizeStoreName(rawStoreName, fallbackStoreId) {
    const value = String(rawStoreName || "").trim();
    return value || String(fallbackStoreId || "").trim();
  }

  function isStoreIdFormatValid(storeId) {
    return /^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(String(storeId || ""));
  }

  async function getUserContextById(userId, client = pool) {
    const result = await client.query(
      `
      SELECT
        u.id,
        u.email,
        u.company_name,
        COALESCE(
          array_remove(array_agg(usr.role), NULL),
          ARRAY[]::text[]
        ) AS roles
      FROM users u
      LEFT JOIN user_store_roles usr
        ON usr.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.company_name
      `,
      [userId]
    );

    return result.rows[0] || null;
  }

  function isMasterAdminFromRoles(roles = []) {
    return Array.isArray(roles) && roles.includes("MASTER_ADMIN");
  }

  async function getRequesterScope(req) {
    const requesterRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const isMasterAdmin = isMasterAdminFromRoles(requesterRoles);
    let companyName = String(req.user?.company_name || "").trim();

    if (!companyName && req.user?.user_id) {
      const r = await pool.query(
        `SELECT company_name FROM users WHERE id = $1`,
        [req.user.user_id]
      );
      companyName = String(r.rows[0]?.company_name || "").trim();
    }

    return {
      isMasterAdmin,
      companyName,
      userId: Number(req.user?.user_id),
    };
  }

  function canManageTargetUser(scope, targetUser) {
    if (!targetUser) return false;
    if (isProtectedUserContext(targetUser)) return false;

    if (scope?.isMasterAdmin) return true;

    const requesterCompany = String(scope?.companyName || "").trim();
    const targetCompany = String(targetUser.company_name || "").trim();

    return Boolean(requesterCompany) && requesterCompany === targetCompany;
  }

  function isProtectedUserRow(row) {
    const roles = Array.isArray(row?.roles)
      ? row.roles.map((r) => String(r?.role || "").toUpperCase())
      : [];
    const email = String(row?.email || "")
      .trim()
      .toLowerCase();

    return PROTECTED_EMAILS.has(email) || roles.includes("MASTER_ADMIN");
  }

  function isProtectedUserContext(userCtx) {
    if (!userCtx) return false;

    const email = String(userCtx.email || "")
      .trim()
      .toLowerCase();
    const roles = Array.isArray(userCtx.roles) ? userCtx.roles : [];

    return PROTECTED_EMAILS.has(email) || roles.includes("MASTER_ADMIN");
  }

  function userCanBeAssignedPortal(userCtx) {
    const roles = Array.isArray(userCtx?.roles) ? userCtx.roles : [];
    return roles.includes("MASTER_ADMIN") || roles.includes("ADMIN");
  }

  async function getTableColumns(tableName) {
    const r = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      `,
      [tableName]
    );

    return new Set(r.rows.map((row) => row.column_name));
  }

  async function ensureCompanyStoresTable(client = pool) {
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS company_stores_id_seq
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_stores (
        id BIGINT PRIMARY KEY DEFAULT nextval('company_stores_id_seq'::regclass),
        company_name TEXT NOT NULL,
        store_id VARCHAR(64) NOT NULL,
        store_name TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (company_name, store_id),
        CHECK (store_id <> '_GLOBAL_')
      )
    `);

    await client.query(`
      ALTER SEQUENCE company_stores_id_seq
      OWNED BY company_stores.id
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_company_stores_company_name
      ON company_stores (company_name)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_company_stores_is_active
      ON company_stores (is_active)
    `);
  }

  async function backfillCompanyStoresFromRoles(client = pool, companyName = "") {
    const targetCompany = String(companyName || "").trim();
    const values = [];
    const where = [
      `usr.store_id <> '_GLOBAL_'`,
      `COALESCE(u.company_name, '') <> ''`,
    ];

    if (targetCompany) {
      values.push(targetCompany);
      where.push(`u.company_name = $${values.length}`);
    }

    await client.query(
      `
      INSERT INTO company_stores (company_name, store_id, store_name, created_at, updated_at)
      SELECT DISTINCT
        u.company_name,
        usr.store_id,
        usr.store_id AS store_name,
        NOW(),
        NOW()
      FROM users u
      JOIN user_store_roles usr
        ON usr.user_id = u.id
      WHERE ${where.join(" AND ")}
      ON CONFLICT (company_name, store_id) DO NOTHING
      `,
      values
    );
  }

  async function upsertCompanyStore({
    client = pool,
    companyName,
    storeId,
    storeName,
    createdByUserId = null,
    isActive = true,
  }) {
    const result = await client.query(
      `
      INSERT INTO company_stores (
        company_name,
        store_id,
        store_name,
        is_active,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (company_name, store_id)
      DO UPDATE SET
        store_name = EXCLUDED.store_name,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id, company_name, store_id, store_name, is_active, created_at, updated_at
      `,
      [companyName, storeId, storeName, isActive, createdByUserId]
    );

    return result.rows[0] || null;
  }

  async function assertAssignableCompanyStore(client, companyName, storeId) {
    await ensureCompanyStoresTable(client);

    const normalizedCompanyName = String(companyName || "").trim();
    const normalizedStoreId = normalizeStoreId(storeId);

    if (!normalizedCompanyName || !normalizedStoreId) {
      return {
        ok: false,
        status: 400,
        error: "company_name and store_id required",
      };
    }

    const storeResult = await client.query(
      `
      SELECT is_active
      FROM company_stores
      WHERE company_name = $1
        AND store_id = $2
      LIMIT 1
      `,
      [normalizedCompanyName, normalizedStoreId]
    );

    if (!storeResult.rowCount) {
      return {
        ok: false,
        status: 400,
        error: "Store not found for company",
      };
    }

    if (storeResult.rows[0].is_active === false) {
      return {
        ok: false,
        status: 400,
        error: "Store is inactive for this company",
      };
    }

    return { ok: true, store_id: normalizedStoreId };
  }

  function parseOptionalText(rawValue, fieldName, maxLength = 255) {
    if (rawValue === null || rawValue === undefined) {
      return { value: null };
    }

    const value = String(rawValue).trim();
    if (!value) {
      return { value: null };
    }

    if (value.length > maxLength) {
      return {
        error: `${fieldName} must be ${maxLength} characters or less`,
      };
    }

    return { value };
  }

  function parseOptionalInteger(rawValue, fieldName, min = 0, max = 100) {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return { value: null };
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value)) {
      return { error: `${fieldName} must be an integer` };
    }

    if (value < min || value > max) {
      return { error: `${fieldName} must be between ${min} and ${max}` };
    }

    return { value };
  }

  function parseOptionalAmount(rawValue, fieldName) {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return { value: null };
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return { error: `${fieldName} must be a valid number` };
    }

    if (value < 0) {
      return { error: `${fieldName} cannot be negative` };
    }

    if (value > 1000000000000) {
      return { error: `${fieldName} is too large` };
    }

    return { value: Number(value.toFixed(2)) };
  }

  function parseOptionalDate(rawValue, fieldName) {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return { value: null };
    }

    const value = String(rawValue).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { error: `${fieldName} must be in YYYY-MM-DD format` };
    }

    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms)) {
      return { error: `${fieldName} must be a valid date` };
    }

    return { value };
  }

  function parseCurrencyCode(rawValue) {
    const value = String(rawValue || "").trim().toUpperCase();
    if (!value) return { value: "LKR" };

    if (!/^[A-Z]{3,8}$/.test(value)) {
      return { error: "currency_code must be 3-8 uppercase letters" };
    }

    return { value };
  }

  function parseAlertSeverity(rawValue) {
    const normalized = String(rawValue || "MEDIUM")
      .trim()
      .toUpperCase();
    if (!normalized) return { value: "MEDIUM" };

    const allowed = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    if (!allowed.has(normalized)) {
      return {
        error: "severity must be one of LOW, MEDIUM, HIGH, CRITICAL",
      };
    }

    return { value: normalized };
  }

  async function ensureCustomerBillingProfilesTable(client = pool) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_billing_profiles (
        id BIGSERIAL PRIMARY KEY,
        company_name TEXT NOT NULL UNIQUE,
        contract_years INTEGER,
        contract_start_date DATE,
        annual_license_fee NUMERIC(14,2),
        monthly_fee NUMERIC(14,2),
        outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        overdue_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        next_due_date DATE,
        currency_code VARCHAR(8) NOT NULL DEFAULT 'LKR',
        bank_name TEXT,
        bank_branch TEXT,
        bank_account_name TEXT,
        bank_account_number TEXT,
        billing_contact_name TEXT,
        billing_contact_email TEXT,
        billing_contact_phone TEXT,
        payment_notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_by_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS contract_years INTEGER
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS contract_start_date DATE
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS annual_license_fee NUMERIC(14,2)
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(14,2)
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS overdue_amount NUMERIC(14,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS next_due_date DATE
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8) NOT NULL DEFAULT 'LKR'
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS bank_name TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS bank_branch TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS bank_account_name TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS bank_account_number TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS billing_contact_name TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS billing_contact_email TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS billing_contact_phone TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS payment_notes TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS updated_by_email TEXT
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await client.query(`
      ALTER TABLE customer_billing_profiles
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_billing_profiles_company_name
      ON customer_billing_profiles (company_name)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_billing_profiles_next_due_date
      ON customer_billing_profiles (next_due_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_billing_profiles_updated_at
      ON customer_billing_profiles (updated_at DESC)
    `);
  }

  async function loadCustomerBillingProfiles({
    client = pool,
    companyName = "",
  } = {}) {
    const normalizedCompanyName = String(companyName || "").trim();
    const values = [];
    let whereSql = "";

    if (normalizedCompanyName) {
      values.push(normalizedCompanyName);
      whereSql = `WHERE cbp.company_name = $1`;
    }

    const result = await client.query(
      `
      SELECT
        cbp.id,
        cbp.company_name,
        cbp.contract_years,
        cbp.contract_start_date,
        cbp.annual_license_fee,
        cbp.monthly_fee,
        cbp.outstanding_amount,
        cbp.overdue_amount,
        cbp.next_due_date,
        cbp.currency_code,
        cbp.bank_name,
        cbp.bank_branch,
        cbp.bank_account_name,
        cbp.bank_account_number,
        cbp.billing_contact_name,
        cbp.billing_contact_email,
        cbp.billing_contact_phone,
        cbp.payment_notes,
        cbp.is_active,
        cbp.updated_by_user_id,
        cbp.updated_by_email,
        cbp.created_at,
        cbp.updated_at,
        CASE
          WHEN cbp.contract_start_date IS NOT NULL
            AND COALESCE(cbp.contract_years, 0) > 0
          THEN (cbp.contract_start_date + make_interval(years => cbp.contract_years))::date
          ELSE NULL
        END AS contract_end_date,
        CASE
          WHEN COALESCE(cbp.overdue_amount, 0) > 0 THEN TRUE
          WHEN cbp.next_due_date IS NOT NULL
            AND cbp.next_due_date < CURRENT_DATE
            AND COALESCE(cbp.outstanding_amount, 0) > 0
          THEN TRUE
          ELSE FALSE
        END AS is_overdue,
        CASE
          WHEN cbp.next_due_date IS NOT NULL
            AND cbp.next_due_date < CURRENT_DATE
          THEN (CURRENT_DATE - cbp.next_due_date)::int
          ELSE 0
        END AS days_overdue
      FROM customer_billing_profiles cbp
      ${whereSql}
      ORDER BY cbp.company_name ASC
      `,
      values
    );

    return result.rows;
  }

  async function ensureCustomerPaymentAlertsTable(client = pool) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_payment_alerts (
        id BIGSERIAL PRIMARY KEY,
        company_name TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'OPEN',
        due_date DATE,
        block_on_due BOOLEAN NOT NULL DEFAULT FALSE,
        block_applied_at TIMESTAMPTZ,
        amount NUMERIC(14,2),
        currency_code VARCHAR(8) NOT NULL DEFAULT 'LKR',
        created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_by_email TEXT,
        resolved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        resolved_by_email TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS title TEXT
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS message TEXT
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'MEDIUM'
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN'
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS due_date DATE
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS block_on_due BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS block_applied_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2)
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8) NOT NULL DEFAULT 'LKR'
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS created_by_email TEXT
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS resolved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS resolved_by_email TEXT
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await client.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_payment_alerts_company_status
      ON customer_payment_alerts (company_name, status, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_payment_alerts_status
      ON customer_payment_alerts (status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_payment_alerts_due_block
      ON customer_payment_alerts (status, due_date, block_on_due)
    `);
  }

  async function loadAuditLogs({ limit, offset }) {
    const auditCols = await getTableColumns("audit_logs");
    const activityCols = await getTableColumns("activity_audit");

    if (auditCols.size > 0) {
      const actorCol = auditCols.has("performed_by")
        ? "al.performed_by"
        : auditCols.has("user_id")
        ? "al.user_id"
        : "NULL::bigint";
      const emailExpr = auditCols.has("email")
        ? "al.email"
        : "u.email";
      const entityTypeExpr = auditCols.has("entity_type")
        ? "al.entity_type"
        : "NULL::text AS entity_type";
      const entityIdExpr = auditCols.has("entity_id")
        ? "al.entity_id"
        : "NULL::text AS entity_id";
      const metadataExpr = auditCols.has("metadata")
        ? "al.metadata"
        : "NULL::jsonb AS metadata";

      const r = await pool.query(
        `
        SELECT
          al.id,
          al.action,
          ${entityTypeExpr},
          ${entityIdExpr},
          ${actorCol} AS performed_by,
          ${metadataExpr},
          al.created_at,
          ${emailExpr} AS email
        FROM audit_logs al
        LEFT JOIN users u
          ON u.id = ${actorCol}
        ORDER BY al.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );

      return r.rows;
    }

    if (activityCols.size > 0) {
      const entityTypeExpr = activityCols.has("entity_type")
        ? "aa.entity_type"
        : "NULL::text AS entity_type";
      const entityIdExpr = activityCols.has("entity_id")
        ? "aa.entity_id"
        : "NULL::text AS entity_id";
      const actorCol = activityCols.has("user_id")
        ? "aa.user_id"
        : "NULL::bigint";
      const metadataExpr = activityCols.has("metadata")
        ? "aa.metadata"
        : "NULL::jsonb AS metadata";
      const emailExpr = activityCols.has("email")
        ? "aa.email"
        : "u.email";

      const r = await pool.query(
        `
        SELECT
          aa.id,
          aa.action,
          ${entityTypeExpr},
          ${entityIdExpr},
          ${actorCol} AS performed_by,
          ${metadataExpr},
          aa.created_at,
          ${emailExpr} AS email
        FROM activity_audit aa
        LEFT JOIN users u
          ON u.id = ${actorCol}
        ORDER BY aa.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );

      return r.rows;
    }

    return [];
  }

  /* =========================================================
     AUTH
  ========================================================= */

  function authenticate(req, res, next) {
    const h = req.headers.authorization;

    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(
        h.split(" ")[1],
        process.env.JWT_SECRET
      );
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function requireAdmin(req, res, next) {
    const roles = req.user?.roles || [];

    if (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    ) {
      return next();
    }

    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  function requireMasterAdmin(req, res, next) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (roles.includes("MASTER_ADMIN")) return next();
    return res.status(403).json({ ok: false, error: "MASTER_ADMIN required" });
  }

  async function tableExists(client, tableName) {
    const r = await client.query(
      `SELECT to_regclass($1) AS regclass_name`,
      [`public.${tableName}`]
    );
    return Boolean(r.rows[0]?.regclass_name);
  }

  /* =========================================================
     TENANT PROVISIONING (MASTER ADMIN)
  ========================================================= */

  router.post(
    "/tenants/provision",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      const companyName = String(req.body?.company_name || "").trim();
      const adminEmail = String(req.body?.admin_email || "")
        .trim()
        .toLowerCase();
      const adminPassword = String(req.body?.admin_password || "");
      const primaryStoreId = String(req.body?.primary_store_id || "").trim();
      const requestedStoreIds = normalizeStoreIds(req.body?.store_ids);
      const fallbackStoreId = buildSeedStoreId(companyName);
      const storeIds = normalizeStoreIds(
        requestedStoreIds.length
          ? requestedStoreIds
          : primaryStoreId
          ? [primaryStoreId]
          : [fallbackStoreId]
      );

      if (!companyName) {
        return res.status(400).json({ ok: false, error: "company_name required" });
      }

      if (!adminEmail || !adminEmail.includes("@")) {
        return res.status(400).json({ ok: false, error: "valid admin_email required" });
      }

      if (!adminPassword || adminPassword.length < 8) {
        return res
          .status(400)
          .json({ ok: false, error: "admin_password must be at least 8 characters" });
      }

      if (!storeIds.length) {
        return res.status(400).json({
          ok: false,
          error: "store_ids required (or provide company_name for auto seed store)",
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const existingUser = await client.query(
          `SELECT id FROM users WHERE email = $1`,
          [adminEmail]
        );

        if (existingUser.rowCount) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            error: "admin_email already exists",
          });
        }

        const hash = await bcrypt.hash(adminPassword, 10);
        const userResult = await client.query(
          `
          INSERT INTO users (email, password_hash, company_name)
          VALUES ($1, $2, $3)
          RETURNING id, email, company_name
          `,
          [adminEmail, hash, companyName]
        );

        const adminUserId = userResult.rows[0].id;

        await ensureCompanyStoresTable(client);

        await client.query(
          `
          INSERT INTO user_store_roles (user_id, store_id, role)
          VALUES ($1, '_GLOBAL_', 'ADMIN')
          ON CONFLICT DO NOTHING
          `,
          [adminUserId]
        );

        await client.query(
          `
          INSERT INTO user_store_roles (user_id, store_id, role)
          SELECT $1, s.store_id, 'ADMIN'
          FROM unnest($2::text[]) AS s(store_id)
          ON CONFLICT DO NOTHING
          `,
          [adminUserId, storeIds]
        );

        const storeTokens = {};
        for (const storeId of storeIds) {
          await upsertCompanyStore({
            client,
            companyName,
            storeId,
            storeName: storeId,
            createdByUserId: req.user?.user_id || null,
            isActive: true,
          });
          storeTokens[storeId] = await generateStoreToken(client, {
            companyName,
            storeId,
            label: storeId,
          });
        }

        const companyToken = await generateCompanyToken(client, { companyName });

        await client.query("COMMIT");

        return res.status(201).json({
          ok: true,
          tenant: {
            company_name: companyName,
            store_ids: storeIds,
            company_token: companyToken,
            store_tokens: storeTokens,
          },
          admin: {
            user_id: adminUserId,
            email: adminEmail,
            roles: ["ADMIN"],
          },
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/tenants/provision]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to provision tenant",
        });
      } finally {
        client.release();
      }
    }
  );

  /* =========================================================
     STORES
  ========================================================= */

  router.get("/stores", authenticate, requireAdmin, async (req, res) => {
    try {
      const scope = await getRequesterScope(req);
      const requestedCompanyName = String(req.query.company_name || "").trim();
      const includeInactive =
        String(req.query.include_inactive || "").trim() === "1";

      await ensureCompanyStoresTable(pool);
      await backfillCompanyStoresFromRoles(
        pool,
        scope.isMasterAdmin ? requestedCompanyName : scope.companyName
      );

      const where = [];
      const values = [];
      let i = 1;

      if (scope.isMasterAdmin) {
        if (requestedCompanyName) {
          where.push(`cs.company_name = $${i++}`);
          values.push(requestedCompanyName);
        }
      } else {
        if (!scope.companyName) {
          return res.status(400).json({
            ok: false,
            error: "Admin account has no company scope",
          });
        }

        if (requestedCompanyName && requestedCompanyName !== scope.companyName) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }

        where.push(`cs.company_name = $${i++}`);
        values.push(scope.companyName);
      }

      if (!includeInactive) {
        where.push(`cs.is_active = TRUE`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const result = await pool.query(
        `
        SELECT
          cs.id,
          cs.company_name,
          cs.store_id,
          cs.store_name,
          cs.is_active,
          cs.created_at,
          cs.updated_at,
          COALESCE(COUNT(DISTINCT usr.user_id), 0)::int AS user_count
        FROM company_stores cs
        LEFT JOIN users u
          ON u.company_name = cs.company_name
        LEFT JOIN user_store_roles usr
          ON usr.user_id = u.id
         AND usr.store_id = cs.store_id
        ${whereSql}
        GROUP BY cs.id
        ORDER BY cs.company_name ASC, cs.store_id ASC
        `,
        values
      );

      return res.json({
        ok: true,
        company_name: scope.isMasterAdmin
          ? requestedCompanyName || null
          : scope.companyName,
        stores: result.rows,
      });
    } catch (e) {
      console.error("[admin/stores]", e);
      return res.status(500).json({ ok: false, error: "Failed to load stores" });
    }
  });

  router.post("/stores", authenticate, requireAdmin, async (req, res) => {
    const requestedCompanyName = String(req.body?.company_name || "").trim();
    const normalizedStoreId = normalizeStoreId(req.body?.store_id);
    const normalizedStoreName = normalizeStoreName(
      req.body?.store_name,
      normalizedStoreId
    );

    if (!normalizedStoreId) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }

    if (normalizedStoreId === "_GLOBAL_") {
      return res.status(400).json({ ok: false, error: "invalid store_id" });
    }

    if (!isStoreIdFormatValid(normalizedStoreId)) {
      return res.status(400).json({
        ok: false,
        error:
          "store_id must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)",
      });
    }

    if (normalizedStoreName.length > 80) {
      return res.status(400).json({
        ok: false,
        error: "store_name must be 80 characters or less",
      });
    }

    let scope;
    try {
      scope = await getRequesterScope(req);
    } catch (e) {
      console.error("[admin/stores/create scope]", e);
      return res.status(500).json({ ok: false, error: "Failed to resolve scope" });
    }

    const companyName = scope.isMasterAdmin
      ? requestedCompanyName
      : scope.companyName;

    if (!companyName) {
      return res.status(400).json({ ok: false, error: "company_name required" });
    }

    if (
      !scope.isMasterAdmin &&
      requestedCompanyName &&
      requestedCompanyName !== scope.companyName
    ) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureCompanyStoresTable(client);

      const createdStore = await upsertCompanyStore({
        client,
        companyName,
        storeId: normalizedStoreId,
        storeName: normalizedStoreName,
        createdByUserId: scope.userId || null,
        isActive: true,
      });

      // Keep company ADMIN accounts mapped to new stores.
      await client.query(
        `
        INSERT INTO user_store_roles (user_id, store_id, role)
        SELECT usr.user_id, $2, usr.role
        FROM user_store_roles usr
        JOIN users u
          ON u.id = usr.user_id
        WHERE usr.role = 'ADMIN'
          AND u.company_name = $1
        ON CONFLICT DO NOTHING
        `,
        [companyName, normalizedStoreId]
      );

      const storeToken = await generateStoreToken(client, {
        companyName,
        storeId: normalizedStoreId,
        label: normalizedStoreName,
      });

      await client.query("COMMIT");
      return res.status(201).json({ ok: true, store: createdStore, store_token: storeToken });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[admin/stores/create]", e);
      return res.status(500).json({ ok: false, error: "Failed to save store" });
    } finally {
      client.release();
    }
  });

  router.post(
    "/stores/:store_id/status",
    authenticate,
    requireAdmin,
    async (req, res) => {
      const requestedCompanyName = String(req.body?.company_name || "").trim();
      const normalizedStoreId = normalizeStoreId(req.params.store_id);
      const isActive = req.body?.is_active;

      if (!normalizedStoreId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (typeof isActive !== "boolean") {
        return res.status(400).json({ ok: false, error: "is_active required" });
      }

      if (!isStoreIdFormatValid(normalizedStoreId)) {
        return res.status(400).json({
          ok: false,
          error:
            "store_id must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)",
        });
      }

      let scope;
      try {
        scope = await getRequesterScope(req);
      } catch (e) {
        console.error("[admin/stores/status scope]", e);
        return res.status(500).json({ ok: false, error: "Failed to resolve scope" });
      }

      const companyName = scope.isMasterAdmin
        ? requestedCompanyName
        : scope.companyName;

      if (!companyName) {
        return res.status(400).json({ ok: false, error: "company_name required" });
      }

      if (
        !scope.isMasterAdmin &&
        requestedCompanyName &&
        requestedCompanyName !== scope.companyName
      ) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      try {
        await ensureCompanyStoresTable(pool);
        const updated = await pool.query(
          `
          UPDATE company_stores
          SET is_active = $3,
              updated_at = NOW()
          WHERE company_name = $1
            AND store_id = $2
          RETURNING id, company_name, store_id, store_name, is_active, created_at, updated_at
          `,
          [companyName, normalizedStoreId, isActive]
        );

        if (!updated.rowCount) {
          return res.status(404).json({ ok: false, error: "Store not found" });
        }

        return res.json({ ok: true, store: updated.rows[0] });
      } catch (e) {
        console.error("[admin/stores/status]", e);
        return res.status(500).json({ ok: false, error: "Failed to update store" });
      }
    }
  );

  router.delete(
    "/stores/:store_id",
    authenticate,
    requireAdmin,
    async (req, res) => {
      const requestedCompanyName = String(
        req.query.company_name || req.body?.company_name || ""
      ).trim();
      const normalizedStoreId = normalizeStoreId(req.params.store_id);

      if (!normalizedStoreId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!isStoreIdFormatValid(normalizedStoreId)) {
        return res.status(400).json({
          ok: false,
          error:
            "store_id must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)",
        });
      }

      let scope;
      try {
        scope = await getRequesterScope(req);
      } catch (e) {
        console.error("[admin/stores/delete scope]", e);
        return res.status(500).json({ ok: false, error: "Failed to resolve scope" });
      }

      const companyName = scope.isMasterAdmin
        ? requestedCompanyName
        : scope.companyName;

      if (!companyName) {
        return res.status(400).json({ ok: false, error: "company_name required" });
      }

      if (
        !scope.isMasterAdmin &&
        requestedCompanyName &&
        requestedCompanyName !== scope.companyName
      ) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await ensureCompanyStoresTable(client);

        const existing = await client.query(
          `
          SELECT id, store_name
          FROM company_stores
          WHERE company_name = $1
            AND store_id = $2
          FOR UPDATE
          `,
          [companyName, normalizedStoreId]
        );

        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "Store not found" });
        }

        const removedRoles = await client.query(
          `
          DELETE FROM user_store_roles usr
          USING users u
          WHERE usr.user_id = u.id
            AND u.company_name = $1
            AND usr.store_id = $2
          `,
          [companyName, normalizedStoreId]
        );

        await client.query(
          `
          DELETE FROM company_stores
          WHERE company_name = $1
            AND store_id = $2
          `,
          [companyName, normalizedStoreId]
        );

        await client.query("COMMIT");
        return res.json({
          ok: true,
          deleted: {
            company_name: companyName,
            store_id: normalizedStoreId,
            store_name: existing.rows[0]?.store_name || normalizedStoreId,
            removed_user_store_roles: removedRoles.rowCount || 0,
          },
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/stores/delete]", e);
        return res.status(500).json({ ok: false, error: "Failed to delete store" });
      } finally {
        client.release();
      }
    }
  );

  /* =========================================================
     SCAN TOKENS (MASTER ADMIN)
  ========================================================= */

  // GET /tokens?company_name=X  — list tokens (all companies if no filter)
  router.get("/tokens", authenticate, requireMasterAdmin, async (req, res) => {
    const companyName = String(req.query.company_name || "").trim();
    try {
      const r = companyName
        ? await pool.query(
            `SELECT id, token, token_type, company_name, store_id, label, is_active, last_used_at, created_at
             FROM scan_tokens
             WHERE company_name = $1
             ORDER BY token_type DESC, store_id NULLS FIRST, created_at`,
            [companyName]
          )
        : await pool.query(
            `SELECT id, token, token_type, company_name, store_id, label, is_active, last_used_at, created_at
             FROM scan_tokens
             ORDER BY company_name, token_type DESC, store_id NULLS FIRST, created_at`
          );
      return res.json({ ok: true, tokens: r.rows });
    } catch (e) {
      console.error("[admin/tokens]", e);
      return res.status(500).json({ ok: false, error: "Failed to load tokens" });
    }
  });

  // POST /tokens/rotate  — deactivate current token and generate a new one
  router.post("/tokens/rotate", authenticate, requireMasterAdmin, async (req, res) => {
    const { company_name, store_id, token_type } = req.body || {};
    if (!company_name || !token_type) {
      return res.status(400).json({ ok: false, error: "company_name and token_type required" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE scan_tokens SET is_active = FALSE, updated_at = NOW()
         WHERE company_name = $1
           AND token_type = $2
           AND ($3::text IS NULL OR store_id = $3)
           AND is_active = TRUE`,
        [company_name, token_type, store_id || null]
      );
      let newToken;
      if (token_type === "store") {
        newToken = await generateStoreToken(client, { companyName: company_name, storeId: store_id, label: store_id });
      } else {
        newToken = await generateCompanyToken(client, { companyName: company_name });
      }
      await client.query("COMMIT");
      return res.json({ ok: true, token: newToken });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[admin/tokens/rotate]", e);
      return res.status(500).json({ ok: false, error: "Failed to rotate token" });
    } finally {
      client.release();
    }
  });

  /* =========================================================
     REGISTERED READERS (MASTER ADMIN)
  ========================================================= */

  // GET /readers?company_name=X&store_id=Y
  router.get("/readers", authenticate, requireMasterAdmin, async (req, res) => {
    const companyName = String(req.query.company_name || "").trim();
    const storeId = String(req.query.store_id || "").trim();
    try {
      const r = await pool.query(
        `SELECT rr.id, rr.device_id, rr.reader_ip, rr.reader_name, rr.zone_id,
                rr.company_name, rr.store_id, rr.is_active, rr.last_seen_at,
                st.token AS store_token
         FROM registered_readers rr
         JOIN scan_tokens st ON st.id = rr.store_token_id
         WHERE ($1 = '' OR rr.company_name = $1)
           AND ($2 = '' OR rr.store_id = $2)
         ORDER BY rr.company_name, rr.store_id, rr.id`,
        [companyName, storeId]
      );
      return res.json({ ok: true, readers: r.rows });
    } catch (e) {
      console.error("[admin/readers]", e);
      return res.status(500).json({ ok: false, error: "Failed to load readers" });
    }
  });

  // POST /readers  — register a new reader
  router.post("/readers", authenticate, requireMasterAdmin, async (req, res) => {
    const { company_name, store_id, reader_ip, reader_name, zone_id, device_id } = req.body || {};
    if (!company_name || !store_id || !reader_ip) {
      return res.status(400).json({ ok: false, error: "company_name, store_id, reader_ip required" });
    }
    const ip = String(reader_ip).trim();
    const zoneId = String(zone_id || "sales_floor").trim();
    const name = String(reader_name || ip).trim();
    const devId = String(device_id || `${store_id}_${ip.replace(/\./g, "_")}`).toUpperCase();

    try {
      const tokenResult = await pool.query(
        `SELECT id FROM scan_tokens
         WHERE token_type = 'store' AND company_name = $1 AND store_id = $2 AND is_active = TRUE
         LIMIT 1`,
        [company_name, store_id]
      );
      if (!tokenResult.rowCount) {
        return res.status(404).json({ ok: false, error: "No active store token found for this store" });
      }
      const storeTokenId = tokenResult.rows[0].id;

      const r = await pool.query(
        `INSERT INTO registered_readers
           (store_token_id, company_name, store_id, device_id, reader_ip, reader_name, zone_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (store_id, reader_ip) DO UPDATE SET
           reader_name = EXCLUDED.reader_name,
           zone_id     = EXCLUDED.zone_id,
           device_id   = EXCLUDED.device_id,
           is_active   = TRUE,
           updated_at  = NOW()
         RETURNING *`,
        [storeTokenId, company_name, store_id, devId, ip, name, zoneId]
      );
      return res.status(201).json({ ok: true, reader: r.rows[0] });
    } catch (e) {
      console.error("[admin/readers/create]", e);
      return res.status(500).json({ ok: false, error: "Failed to register reader" });
    }
  });

  // PATCH /readers/:id  — update zone or name
  router.patch("/readers/:id", authenticate, requireMasterAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { reader_name, zone_id, is_active } = req.body || {};
    try {
      const r = await pool.query(
        `UPDATE registered_readers SET
           reader_name = COALESCE($2, reader_name),
           zone_id     = COALESCE($3, zone_id),
           is_active   = COALESCE($4, is_active),
           updated_at  = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, reader_name || null, zone_id || null, is_active ?? null]
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, error: "Reader not found" });
      return res.json({ ok: true, reader: r.rows[0] });
    } catch (e) {
      console.error("[admin/readers/patch]", e);
      return res.status(500).json({ ok: false, error: "Failed to update reader" });
    }
  });

  // DELETE /readers/:id
  router.delete("/readers/:id", authenticate, requireMasterAdmin, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const r = await pool.query(
        `DELETE FROM registered_readers WHERE id = $1 RETURNING id`,
        [id]
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, error: "Reader not found" });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Failed to delete reader" });
    }
  });

  /* =========================================================
     CUSTOMER BILLING PROFILES (MASTER ADMIN)
  ========================================================= */

  router.get(
    "/customer-billing-profiles",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      try {
        const requestedCompanyName = String(req.query.company_name || "").trim();
        await ensureCustomerBillingProfilesTable(pool);

        const profiles = await loadCustomerBillingProfiles({
          client: pool,
          companyName: requestedCompanyName,
        });

        return res.json({
          ok: true,
          company_name: requestedCompanyName || null,
          profiles,
        });
      } catch (e) {
        console.error("[admin/customer-billing-profiles/list]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to load customer billing profiles",
        });
      }
    }
  );

  router.put(
    "/customer-billing-profiles/:company_name",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      const companyName = String(req.params.company_name || "").trim();
      if (!companyName) {
        return res.status(400).json({
          ok: false,
          error: "company_name required",
        });
      }

      const bodyCompanyName = String(req.body?.company_name || "").trim();
      if (bodyCompanyName && bodyCompanyName !== companyName) {
        return res.status(400).json({
          ok: false,
          error: "company_name mismatch",
        });
      }

      const contractYearsResult = parseOptionalInteger(
        req.body?.contract_years,
        "contract_years",
        1,
        50
      );
      if (contractYearsResult.error) {
        return res.status(400).json({ ok: false, error: contractYearsResult.error });
      }

      const contractStartDateResult = parseOptionalDate(
        req.body?.contract_start_date,
        "contract_start_date"
      );
      if (contractStartDateResult.error) {
        return res.status(400).json({ ok: false, error: contractStartDateResult.error });
      }

      const annualLicenseFeeResult = parseOptionalAmount(
        req.body?.annual_license_fee,
        "annual_license_fee"
      );
      if (annualLicenseFeeResult.error) {
        return res.status(400).json({ ok: false, error: annualLicenseFeeResult.error });
      }

      const monthlyFeeResult = parseOptionalAmount(
        req.body?.monthly_fee,
        "monthly_fee"
      );
      if (monthlyFeeResult.error) {
        return res.status(400).json({ ok: false, error: monthlyFeeResult.error });
      }

      const outstandingAmountResult = parseOptionalAmount(
        req.body?.outstanding_amount,
        "outstanding_amount"
      );
      if (outstandingAmountResult.error) {
        return res.status(400).json({ ok: false, error: outstandingAmountResult.error });
      }

      const overdueAmountResult = parseOptionalAmount(
        req.body?.overdue_amount,
        "overdue_amount"
      );
      if (overdueAmountResult.error) {
        return res.status(400).json({ ok: false, error: overdueAmountResult.error });
      }

      const nextDueDateResult = parseOptionalDate(
        req.body?.next_due_date,
        "next_due_date"
      );
      if (nextDueDateResult.error) {
        return res.status(400).json({ ok: false, error: nextDueDateResult.error });
      }

      const currencyCodeResult = parseCurrencyCode(req.body?.currency_code);
      if (currencyCodeResult.error) {
        return res.status(400).json({ ok: false, error: currencyCodeResult.error });
      }

      const bankNameResult = parseOptionalText(req.body?.bank_name, "bank_name", 120);
      if (bankNameResult.error) {
        return res.status(400).json({ ok: false, error: bankNameResult.error });
      }

      const bankBranchResult = parseOptionalText(req.body?.bank_branch, "bank_branch", 120);
      if (bankBranchResult.error) {
        return res.status(400).json({ ok: false, error: bankBranchResult.error });
      }

      const bankAccountNameResult = parseOptionalText(
        req.body?.bank_account_name,
        "bank_account_name",
        120
      );
      if (bankAccountNameResult.error) {
        return res.status(400).json({ ok: false, error: bankAccountNameResult.error });
      }

      const bankAccountNumberResult = parseOptionalText(
        req.body?.bank_account_number,
        "bank_account_number",
        80
      );
      if (bankAccountNumberResult.error) {
        return res.status(400).json({ ok: false, error: bankAccountNumberResult.error });
      }

      const billingContactNameResult = parseOptionalText(
        req.body?.billing_contact_name,
        "billing_contact_name",
        120
      );
      if (billingContactNameResult.error) {
        return res.status(400).json({ ok: false, error: billingContactNameResult.error });
      }

      const billingContactEmailResult = parseOptionalText(
        req.body?.billing_contact_email,
        "billing_contact_email",
        160
      );
      if (billingContactEmailResult.error) {
        return res.status(400).json({ ok: false, error: billingContactEmailResult.error });
      }

      if (
        billingContactEmailResult.value &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingContactEmailResult.value)
      ) {
        return res.status(400).json({
          ok: false,
          error: "billing_contact_email must be a valid email",
        });
      }

      const billingContactPhoneResult = parseOptionalText(
        req.body?.billing_contact_phone,
        "billing_contact_phone",
        50
      );
      if (billingContactPhoneResult.error) {
        return res.status(400).json({ ok: false, error: billingContactPhoneResult.error });
      }

      const paymentNotesResult = parseOptionalText(
        req.body?.payment_notes,
        "payment_notes",
        1000
      );
      if (paymentNotesResult.error) {
        return res.status(400).json({ ok: false, error: paymentNotesResult.error });
      }

      const isActiveInput = req.body?.is_active;
      if (isActiveInput !== undefined && typeof isActiveInput !== "boolean") {
        return res.status(400).json({ ok: false, error: "is_active must be boolean" });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await ensureCustomerBillingProfilesTable(client);

        const existingResult = await client.query(
          `
          SELECT is_active
          FROM customer_billing_profiles
          WHERE company_name = $1
          LIMIT 1
          `,
          [companyName]
        );

        const resolvedIsActive =
          typeof isActiveInput === "boolean"
            ? isActiveInput
            : existingResult.rows[0]?.is_active ?? true;

        await client.query(
          `
          INSERT INTO customer_billing_profiles (
            company_name,
            contract_years,
            contract_start_date,
            annual_license_fee,
            monthly_fee,
            outstanding_amount,
            overdue_amount,
            next_due_date,
            currency_code,
            bank_name,
            bank_branch,
            bank_account_name,
            bank_account_number,
            billing_contact_name,
            billing_contact_email,
            billing_contact_phone,
            payment_notes,
            is_active,
            updated_by_user_id,
            updated_by_email,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19,
            $20,
            NOW(),
            NOW()
          )
          ON CONFLICT (company_name)
          DO UPDATE SET
            contract_years = EXCLUDED.contract_years,
            contract_start_date = EXCLUDED.contract_start_date,
            annual_license_fee = EXCLUDED.annual_license_fee,
            monthly_fee = EXCLUDED.monthly_fee,
            outstanding_amount = EXCLUDED.outstanding_amount,
            overdue_amount = EXCLUDED.overdue_amount,
            next_due_date = EXCLUDED.next_due_date,
            currency_code = EXCLUDED.currency_code,
            bank_name = EXCLUDED.bank_name,
            bank_branch = EXCLUDED.bank_branch,
            bank_account_name = EXCLUDED.bank_account_name,
            bank_account_number = EXCLUDED.bank_account_number,
            billing_contact_name = EXCLUDED.billing_contact_name,
            billing_contact_email = EXCLUDED.billing_contact_email,
            billing_contact_phone = EXCLUDED.billing_contact_phone,
            payment_notes = EXCLUDED.payment_notes,
            is_active = EXCLUDED.is_active,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_by_email = EXCLUDED.updated_by_email,
            updated_at = NOW()
          `,
          [
            companyName,
            contractYearsResult.value,
            contractStartDateResult.value,
            annualLicenseFeeResult.value,
            monthlyFeeResult.value,
            outstandingAmountResult.value ?? 0,
            overdueAmountResult.value ?? 0,
            nextDueDateResult.value,
            currencyCodeResult.value,
            bankNameResult.value,
            bankBranchResult.value,
            bankAccountNameResult.value,
            bankAccountNumberResult.value,
            billingContactNameResult.value,
            billingContactEmailResult.value,
            billingContactPhoneResult.value,
            paymentNotesResult.value,
            resolvedIsActive,
            req.user?.user_id || null,
            String(req.user?.email || "").trim() || null,
          ]
        );

        const savedRows = await loadCustomerBillingProfiles({
          client,
          companyName,
        });

        await client.query("COMMIT");
        return res.json({
          ok: true,
          profile: savedRows[0] || null,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/customer-billing-profiles/upsert]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to save customer billing profile",
        });
      } finally {
        client.release();
      }
    }
  );

  /* =========================================================
     CUSTOMER PAYMENT ALERTS
  ========================================================= */

  router.get(
    "/customer-payment-alerts",
    authenticate,
    requireAdmin,
    async (req, res) => {
      try {
        const scope = await getRequesterScope(req);
        const requestedCompanyName = String(req.query.company_name || "").trim();
        const requestedStatus = String(req.query.status || "").trim().toUpperCase();
        const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

        const statuses = new Set(["OPEN", "RESOLVED"]);
        if (requestedStatus && !statuses.has(requestedStatus)) {
          return res.status(400).json({
            ok: false,
            error: "status must be OPEN or RESOLVED",
          });
        }

        await ensureCustomerPaymentAlertsTable(pool);

        const where = [];
        const values = [];
        let i = 1;

        if (scope.isMasterAdmin) {
          if (requestedCompanyName) {
            where.push(`cpa.company_name = $${i++}`);
            values.push(requestedCompanyName);
          }
        } else {
          if (!scope.companyName) {
            return res.json({ ok: true, alerts: [] });
          }

          if (requestedCompanyName && requestedCompanyName !== scope.companyName) {
            return res.status(403).json({ ok: false, error: "Forbidden" });
          }

          where.push(`cpa.company_name = $${i++}`);
          values.push(scope.companyName);
        }

        if (requestedStatus) {
          where.push(`cpa.status = $${i++}`);
          values.push(requestedStatus);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        values.push(limit);

        const result = await pool.query(
          `
          SELECT
            cpa.id,
            cpa.company_name,
            cpa.title,
            cpa.message,
            cpa.severity,
            cpa.status,
            cpa.due_date,
            cpa.block_on_due,
            cpa.block_applied_at,
            cpa.amount,
            cpa.currency_code,
            cpa.created_by_user_id,
            cpa.created_by_email,
            cpa.resolved_by_user_id,
            cpa.resolved_by_email,
            cpa.resolved_at,
            cpa.created_at,
            cpa.updated_at,
            CASE
              WHEN cpa.status = 'OPEN'
                AND COALESCE(cpa.block_on_due, FALSE) = TRUE
                AND cpa.due_date IS NOT NULL
                AND cpa.due_date <= CURRENT_DATE
              THEN TRUE
              ELSE FALSE
            END AS is_blocking_now
          FROM customer_payment_alerts cpa
          ${whereSql}
          ORDER BY
            cpa.status = 'OPEN' DESC,
            cpa.created_at DESC
          LIMIT $${i++}
          `,
          values
        );

        return res.json({
          ok: true,
          company_name: scope.isMasterAdmin
            ? requestedCompanyName || null
            : scope.companyName,
          alerts: result.rows,
        });
      } catch (e) {
        console.error("[admin/customer-payment-alerts/list]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to load customer payment alerts",
        });
      }
    }
  );

  router.post(
    "/customer-payment-alerts",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      const companyName = String(req.body?.company_name || "").trim();
      if (!companyName) {
        return res.status(400).json({ ok: false, error: "company_name required" });
      }

      const titleResult = parseOptionalText(
        req.body?.title || "Payment Due Reminder",
        "title",
        160
      );
      if (titleResult.error) {
        return res.status(400).json({ ok: false, error: titleResult.error });
      }

      const messageResult = parseOptionalText(req.body?.message, "message", 2000);
      if (messageResult.error) {
        return res.status(400).json({ ok: false, error: messageResult.error });
      }

      if (!messageResult.value) {
        return res.status(400).json({
          ok: false,
          error: "message required",
        });
      }

      const severityResult = parseAlertSeverity(req.body?.severity);
      if (severityResult.error) {
        return res.status(400).json({ ok: false, error: severityResult.error });
      }

      const dueDateResult = parseOptionalDate(req.body?.due_date, "due_date");
      if (dueDateResult.error) {
        return res.status(400).json({ ok: false, error: dueDateResult.error });
      }

      const blockOnDueInput = req.body?.block_on_due;
      if (blockOnDueInput !== undefined && typeof blockOnDueInput !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "block_on_due must be boolean",
        });
      }
      const blockOnDue = Boolean(blockOnDueInput);
      if (blockOnDue && !dueDateResult.value) {
        return res.status(400).json({
          ok: false,
          error: "due_date required when block_on_due is enabled",
        });
      }

      const amountResult = parseOptionalAmount(req.body?.amount, "amount");
      if (amountResult.error) {
        return res.status(400).json({ ok: false, error: amountResult.error });
      }

      const currencyResult = parseCurrencyCode(req.body?.currency_code);
      if (currencyResult.error) {
        return res.status(400).json({ ok: false, error: currencyResult.error });
      }

      try {
        await ensureCustomerPaymentAlertsTable(pool);

        const insertResult = await pool.query(
          `
          INSERT INTO customer_payment_alerts (
            company_name,
            title,
            message,
            severity,
            status,
            due_date,
            block_on_due,
            block_applied_at,
            amount,
            currency_code,
            created_by_user_id,
            created_by_email,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'OPEN',
            $5,
            $6,
            NULL,
            $7,
            $8,
            $9,
            $10,
            NOW(),
            NOW()
          )
          RETURNING
            id,
            company_name,
            title,
            message,
            severity,
            status,
            due_date,
            block_on_due,
            block_applied_at,
            amount,
            currency_code,
            created_by_user_id,
            created_by_email,
            resolved_by_user_id,
            resolved_by_email,
            resolved_at,
            created_at,
            updated_at
          `,
          [
            companyName,
            titleResult.value || "Payment Due Reminder",
            messageResult.value,
            severityResult.value,
            dueDateResult.value,
            blockOnDue,
            amountResult.value,
            currencyResult.value,
            req.user?.user_id || null,
            String(req.user?.email || "").trim() || null,
          ]
        );

        return res.status(201).json({
          ok: true,
          alert: insertResult.rows[0] || null,
        });
      } catch (e) {
        console.error("[admin/customer-payment-alerts/create]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to create customer payment alert",
        });
      }
    }
  );

  router.post(
    "/customer-payment-alerts/:id/resolve",
    authenticate,
    requireAdmin,
    async (req, res) => {
      const alertId = Number(req.params.id);
      if (!Number.isInteger(alertId) || alertId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Invalid alert id",
        });
      }

      let scope;
      try {
        scope = await getRequesterScope(req);
      } catch (e) {
        console.error("[admin/customer-payment-alerts/resolve scope]", e);
        return res.status(500).json({ ok: false, error: "Failed to resolve scope" });
      }

      try {
        await ensureCustomerPaymentAlertsTable(pool);

        const existing = await pool.query(
          `
          SELECT
            id,
            company_name,
            status
          FROM customer_payment_alerts
          WHERE id = $1
          LIMIT 1
          `,
          [alertId]
        );

        if (!existing.rowCount) {
          return res.status(404).json({ ok: false, error: "Alert not found" });
        }

        const row = existing.rows[0];
        if (!scope.isMasterAdmin && String(row.company_name || "").trim() !== scope.companyName) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }

        if (String(row.status || "").toUpperCase() !== "OPEN") {
          return res.status(400).json({
            ok: false,
            error: "Alert already resolved",
          });
        }

        const updated = await pool.query(
          `
          UPDATE customer_payment_alerts
          SET
            status = 'RESOLVED',
            resolved_at = NOW(),
            resolved_by_user_id = $2,
            resolved_by_email = $3,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            company_name,
            title,
            message,
            severity,
            status,
            due_date,
            block_on_due,
            block_applied_at,
            amount,
            currency_code,
            created_by_user_id,
            created_by_email,
            resolved_by_user_id,
            resolved_by_email,
            resolved_at,
            created_at,
            updated_at
          `,
          [
            alertId,
            req.user?.user_id || null,
            String(req.user?.email || "").trim() || null,
          ]
        );

        return res.json({
          ok: true,
          alert: updated.rows[0] || null,
        });
      } catch (e) {
        console.error("[admin/customer-payment-alerts/resolve]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to resolve customer payment alert",
        });
      }
    }
  );

  /* =========================================================
     USERS
  ========================================================= */

  // LIST USERS
  router.get("/users", authenticate, requireAdmin, async (req, res) => {
    try {
      const scope = await getRequesterScope(req);
      const where = [];
      const values = [];
      let i = 1;

      if (!scope.isMasterAdmin) {
        if (!scope.companyName) {
          return res.json({ ok: true, users: [] });
        }
        where.push(`u.company_name = $${i++}`);
        values.push(scope.companyName);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const r = await pool.query(
        `
        SELECT
          u.id,
          u.email,
          u.company_name,
          u.is_active,
          json_agg(
            json_build_object(
              'role', usr.role,
              'store_id', usr.store_id
            )
          ) FILTER (WHERE usr.role IS NOT NULL) AS roles
        FROM users u
        LEFT JOIN user_store_roles usr ON usr.user_id = u.id
        ${whereSql}
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `,
        values
      );

      let users = r.rows;
      if (!scope.isMasterAdmin) {
        users = users.filter((row) => !isProtectedUserRow(row));
      }

      res.json({ ok: true, users });
    } catch (e) {
      console.error("[admin/users]", e);
      res.status(500).json({ ok: false, error: "Failed to load users" });
    }
  });

  // CREATE USER
  router.post("/users", authenticate, requireAdmin, async (req, res) => {
    const { email, password, role, store_id, company_name } = req.body;
    const normalizedRole = String(role || "")
      .trim()
      .toUpperCase();
    const normalizedStoreId = GLOBAL_ROLES.has(normalizedRole)
      ? "_GLOBAL_"
      : normalizeStoreId(store_id);
    const requestedCompanyName = String(company_name || "").trim();

    if (!email || !password || !role) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields",
      });
    }

    if (normalizedRole === "MASTER_ADMIN") {
      return res.status(403).json({
        ok: false,
        error: "MASTER_ADMIN is system reserved",
      });
    }

    if (!USER_MANAGED_ROLES.has(normalizedRole)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid role",
      });
    }

    if (!GLOBAL_ROLES.has(normalizedRole) && !normalizedStoreId) {
      return res.status(400).json({
        ok: false,
        error: "Store required for this role",
      });
    }

    if (!GLOBAL_ROLES.has(normalizedRole) && !isStoreIdFormatValid(normalizedStoreId)) {
      return res.status(400).json({
        ok: false,
        error:
          "store_id must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)",
      });
    }

    let scope;
    try {
      scope = await getRequesterScope(req);
    } catch (e) {
      console.error("[admin/create-user scope]", e);
      return res.status(500).json({ ok: false, error: "Failed to resolve scope" });
    }

    // Only master admin can create ADMIN accounts
    if (!scope.isMasterAdmin && normalizedRole === "ADMIN") {
      return res.status(403).json({
        ok: false,
        error: "Only a master admin can create admin accounts.",
      });
    }

    const effectiveCompanyName = scope.isMasterAdmin
      ? requestedCompanyName
      : scope.companyName;

    if (!scope.isMasterAdmin && !effectiveCompanyName) {
      return res.status(400).json({
        ok: false,
        error: "Admin account has no company scope",
      });
    }

    if (!effectiveCompanyName) {
      return res.status(400).json({
        ok: false,
        error: "company_name required",
      });
    }

    if (
      !scope.isMasterAdmin &&
      requestedCompanyName &&
      requestedCompanyName !== scope.companyName
    ) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden",
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const u = await client.query(
        `INSERT INTO users (email, password_hash, company_name, force_password_change)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id`,
        [email.toLowerCase(), hash, effectiveCompanyName]
      );

      await client.query(
        `INSERT INTO user_store_roles (user_id, store_id, role)
         VALUES ($1, $2, $3)`,
        [
          u.rows[0].id,
          normalizedStoreId,
          normalizedRole,
        ]
      );

      if (normalizedRole === "ADMIN" && effectiveCompanyName) {
        await ensureCompanyStoresTable(client);
        await client.query(
          `
          INSERT INTO user_store_roles (user_id, store_id, role)
          SELECT $1, cs.store_id, 'ADMIN'
          FROM company_stores cs
          WHERE cs.company_name = $2
            AND cs.is_active = TRUE
          ON CONFLICT DO NOTHING
          `,
          [u.rows[0].id, effectiveCompanyName]
        );
      }

      if (!GLOBAL_ROLES.has(normalizedRole) && normalizedStoreId) {
        const assignableStore = await assertAssignableCompanyStore(
          client,
          effectiveCompanyName,
          normalizedStoreId
        );
        if (!assignableStore.ok) {
          await client.query("ROLLBACK");
          return res
            .status(assignableStore.status || 400)
            .json({ ok: false, error: assignableStore.error });
        }
      }

      // Auto-assign all company-purchased products to the new user
      if (effectiveCompanyName) {
        await ensureProductAccessTables(client);
        const companyProds = await getEnabledCompanyProducts(client, effectiveCompanyName);
        for (const productKey of companyProds) {
          await client.query(
            `INSERT INTO user_products (user_id, product_key, is_enabled, created_by_user_id, created_by_email)
             VALUES ($1, $2, TRUE, $3, $4)
             ON CONFLICT (user_id, product_key) DO NOTHING`,
            [u.rows[0].id, productKey, scope.userId || null, req.user?.email || null]
          );
        }
      }

      await client.query("COMMIT");

      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");

      if (e.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "User already exists",
        });
      }

      console.error("[admin/create-user]", e);
      res.status(500).json({ ok: false, error: "Failed to create user" });
    } finally {
      client.release();
    }
  });

  router.get("/software-access", authenticate, requireAdmin, async (req, res) => {
    try {
      const scope = await getRequesterScope(req);
      const requestedCompanyName = String(req.query.company_name || "").trim();
      const targetCompany = scope.isMasterAdmin
        ? requestedCompanyName
        : String(scope.companyName || "").trim();

      if (!targetCompany) {
        return res.status(400).json({
          ok: false,
          error: "company_name required",
        });
      }

      await ensureProductAccessTables(pool);

      const companyProducts = await getEnabledCompanyProducts(pool, targetCompany);
      const usersResult = await pool.query(
        `
        SELECT
          u.id,
          u.email,
          u.company_name,
          u.is_active,
          json_agg(
            json_build_object(
              'role', usr.role,
              'store_id', usr.store_id
            )
          ) FILTER (WHERE usr.role IS NOT NULL) AS roles
        FROM users u
        LEFT JOIN user_store_roles usr
          ON usr.user_id = u.id
        WHERE u.company_name = $1
        GROUP BY u.id
        ORDER BY u.created_at DESC, u.id DESC
        `,
        [targetCompany]
      );

      let users = usersResult.rows || [];
      if (!scope.isMasterAdmin) {
        users = users.filter((row) => !isProtectedUserRow(row));
      }

      const productMap = await getEnabledUserProductMap(
        pool,
        users.map((row) => row.id)
      );

      users = users.map((row) => ({
        ...row,
        product_keys: productMap[row.id] || [],
      }));

      return res.json({
        ok: true,
        company_name: targetCompany,
        catalog: SOFTWARE_CATALOG,
        company_products: companyProducts,
        users,
      });
    } catch (e) {
      console.error("[admin/software-access GET]", e);
      return res.status(500).json({
        ok: false,
        error: "Failed to load software access",
      });
    }
  });

  router.put(
    "/software-access/company/:company_name",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      const companyName = String(req.params.company_name || "").trim();
      const productKeys = normalizeProductKeys(req.body?.products, {
        companyAssignableOnly: true,
      });

      if (!companyName) {
        return res.status(400).json({
          ok: false,
          error: "company_name required",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await ensureProductAccessTables(client);

        const savedProducts = await replaceCompanyProducts(
          client,
          companyName,
          productKeys,
          {
            user_id: req.user?.user_id || null,
            email: String(req.user?.email || "").trim() || null,
          }
        );

        await client.query(
          `
          DELETE FROM user_products up
          USING users u
          WHERE up.user_id = u.id
            AND u.company_name = $1
            AND up.product_key <> 'portal'
            AND up.product_key <> ALL($2::text[])
          `,
          [companyName, productKeys.length ? productKeys : ["__NONE__"]]
        );

        await client.query("COMMIT");
        return res.json({
          ok: true,
          company_name: companyName,
          products: savedProducts,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/software-access company PUT]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to save company software access",
        });
      } finally {
        client.release();
      }
    }
  );

  router.put(
    "/software-access/users/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user id",
        });
      }

      if (!Array.isArray(req.body?.products)) {
        return res.status(400).json({
          ok: false,
          error: "products must be an array",
        });
      }

      const client = await pool.connect();
      try {
        const scope = await getRequesterScope(req);
        const targetUser = await getUserContextById(userId, client);

        if (!targetUser) {
          return res.status(404).json({
            ok: false,
            error: "User not found",
          });
        }

        if (!canManageTargetUser(scope, targetUser)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden",
          });
        }

        await client.query("BEGIN");
        await ensureProductAccessTables(client);

        const companyProducts = await getEnabledCompanyProducts(
          client,
          String(targetUser.company_name || "").trim()
        );
        const nextProducts = normalizeProductKeys(req.body?.products);
        const allowedProducts = new Set(companyProducts);

        if (userCanBeAssignedPortal(targetUser)) {
          allowedProducts.add("portal");
        }

        const disallowedProducts = nextProducts.filter(
          (productKey) => !allowedProducts.has(productKey)
        );

        if (disallowedProducts.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: `These products are not allowed for this user: ${disallowedProducts.join(", ")}`,
          });
        }

        const savedProducts = await replaceUserProducts(client, userId, nextProducts, {
          user_id: req.user?.user_id || null,
          email: String(req.user?.email || "").trim() || null,
        });

        await client.query("COMMIT");
        return res.json({
          ok: true,
          user_id: userId,
          products: savedProducts,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/software-access user PUT]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to save user software access",
        });
      } finally {
        client.release();
      }
    }
  );

  // RESET PASSWORD
  router.post(
    "/users/:id/reset-password",
    authenticate,
    requireAdmin,
    async (req, res) => {
      try {
        const { password } = req.body;
        const userId = Number(req.params.id);
        const scope = await getRequesterScope(req);

        if (!password) {
          return res.status(400).json({
            ok: false,
            error: "Password required",
          });
        }

        if (!Number.isInteger(userId) || userId <= 0) {
          return res.status(400).json({
            ok: false,
            error: "Invalid user id",
          });
        }

        const targetUser = await getUserContextById(userId);
        if (!targetUser) {
          return res.status(404).json({
            ok: false,
            error: "User not found",
          });
        }

        if (!canManageTargetUser(scope, targetUser)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden",
          });
        }

        const hash = await bcrypt.hash(password, 10);

        await pool.query(
          `UPDATE users SET password_hash=$1, force_password_change=TRUE, updated_at=NOW() WHERE id=$2`,
          [hash, userId]
        );

        res.json({ ok: true });
      } catch (e) {
        console.error("[admin/reset-password]", e);
        res.status(500).json({ ok: false, error: "Failed to reset password" });
      }
    }
  );

  // REPLACE USER ROLE
  router.put(
    "/users/:id/roles",
    authenticate,
    requireAdmin,
    async (req, res) => {
      const { id } = req.params;
      const { role, store_id } = req.body || {};
      const userId = Number(id);
      const normalizedRole = String(role || "")
        .trim()
        .toUpperCase();
      const normalizedStoreId = GLOBAL_ROLES.has(normalizedRole)
        ? "_GLOBAL_"
        : normalizeStoreId(store_id);
      const client = await pool.connect();

      try {
        const scope = await getRequesterScope(req);

        if (!Number.isInteger(userId) || userId <= 0) {
          return res.status(400).json({
            ok: false,
            error: "Invalid user id",
          });
        }

        if (normalizedRole === "MASTER_ADMIN") {
          return res.status(403).json({
            ok: false,
            error: "MASTER_ADMIN is system reserved",
          });
        }

        if (!USER_MANAGED_ROLES.has(normalizedRole)) {
          return res.status(400).json({
            ok: false,
            error: "Invalid role",
          });
        }

        if (!GLOBAL_ROLES.has(normalizedRole) && !normalizedStoreId) {
          return res.status(400).json({
            ok: false,
            error: "Store required for this role",
          });
        }

        if (!GLOBAL_ROLES.has(normalizedRole) && !isStoreIdFormatValid(normalizedStoreId)) {
          return res.status(400).json({
            ok: false,
            error:
              "store_id must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)",
          });
        }

        await client.query("BEGIN");

        const userResult = await client.query(
          `SELECT id FROM users WHERE id = $1`,
          [userId]
        );

        if (!userResult.rowCount) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            ok: false,
            error: "User not found",
          });
        }

        const targetUser = await getUserContextById(userId, client);
        if (!canManageTargetUser(scope, targetUser)) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            ok: false,
            error: "Forbidden",
          });
        }

        await client.query(
          `DELETE FROM user_store_roles WHERE user_id = $1`,
          [userId]
        );

        await client.query(
          `INSERT INTO user_store_roles (user_id, store_id, role)
           VALUES ($1, $2, $3)`,
          [userId, normalizedStoreId, normalizedRole]
        );

        if (normalizedRole === "ADMIN") {
          const targetCompanyName = String(targetUser.company_name || "").trim();
          if (targetCompanyName) {
            await ensureCompanyStoresTable(client);
            await client.query(
              `
              INSERT INTO user_store_roles (user_id, store_id, role)
              SELECT $1, cs.store_id, 'ADMIN'
              FROM company_stores cs
              WHERE cs.company_name = $2
                AND cs.is_active = TRUE
              ON CONFLICT DO NOTHING
              `,
              [userId, targetCompanyName]
            );
          }
        }

        if (!GLOBAL_ROLES.has(normalizedRole) && normalizedStoreId) {
          const assignableStore = await assertAssignableCompanyStore(
            client,
            String(targetUser.company_name || "").trim(),
            normalizedStoreId
          );
          if (!assignableStore.ok) {
            await client.query("ROLLBACK");
            return res
              .status(assignableStore.status || 400)
              .json({ ok: false, error: assignableStore.error });
          }
        }

        await client.query("COMMIT");

        return res.json({
          ok: true,
          user_id: userId,
          role: normalizedRole,
          store_id: normalizedStoreId,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/users/roles]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to update role",
        });
      } finally {
        client.release();
      }
    }
  );

  /* =========================================================
     USER STATUS (ENABLE / DISABLE)
  ========================================================= */

  router.post(
    "/users/:id/status",
    authenticate,
    requireAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const { is_active } = req.body;
        const userId = Number(id);
        const scope = await getRequesterScope(req);

        if (typeof is_active !== "boolean") {
          return res.status(400).json({
            ok: false,
            error: "invalid_status",
          });
        }

        if (!Number.isInteger(userId) || userId <= 0) {
          return res.status(400).json({
            ok: false,
            error: "Invalid user id",
          });
        }

        const targetUser = await getUserContextById(userId);
        if (!targetUser) {
          return res.status(404).json({
            ok: false,
            error: "User not found",
          });
        }

        if (!canManageTargetUser(scope, targetUser)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden",
          });
        }

        // Only master admin can disable/enable admin accounts
        const targetRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
        if (!scope.isMasterAdmin && targetRoles.includes("ADMIN")) {
          return res.status(403).json({
            ok: false,
            error: "Only a master admin can disable or enable admin accounts.",
          });
        }

        await pool.query(
          `
          UPDATE users
          SET is_active = $1
          WHERE id = $2
          `,
          [is_active, userId]
        );

        res.json({ ok: true });
      } catch (e) {
        console.error("[admin/users/status]", e);
        res.status(500).json({
          ok: false,
          error: "failed_to_update_status",
        });
      }
    }
  );

  /* =========================================================
     DELETE USER
  ========================================================= */

  router.delete(
    "/users/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const userId = Number(id);
        const scope = await getRequesterScope(req);

        if (!Number.isInteger(userId) || userId <= 0) {
          return res.status(400).json({
            ok: false,
            error: "Invalid user id",
          });
        }

        // Prevent deleting yourself
        if (userId === req.user.user_id) {
          return res.status(400).json({
            ok: false,
            error: "You cannot delete your own account",
          });
        }

        const targetUser = await getUserContextById(userId);
        if (!targetUser) {
          return res.status(404).json({
            ok: false,
            error: "User not found",
          });
        }

        if (!canManageTargetUser(scope, targetUser)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden",
          });
        }

        // Only master admin can delete admin accounts
        const targetRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
        if (!scope.isMasterAdmin && targetRoles.includes("ADMIN")) {
          return res.status(403).json({
            ok: false,
            error: "Only a master admin can delete admin accounts.",
          });
        }

        await pool.query(
          "DELETE FROM user_store_roles WHERE user_id = $1",
          [userId]
        );

        await pool.query(
          "DELETE FROM users WHERE id = $1",
          [userId]
        );

        res.json({ ok: true });
      } catch (e) {
        console.error("[admin/delete-user]", e);
        res.status(500).json({
          ok: false,
          error: "Failed to delete user",
        });
      }
    }
  );

  /* =========================================================
     OPERATIONAL LOGS RESET (MASTER ADMIN)
  ========================================================= */
  router.post(
    "/operations/clear-logs",
    authenticate,
    requireMasterAdmin,
    async (req, res) => {
      const storeId = req.body?.store_id ? String(req.body.store_id).trim() : "";
      if (!storeId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      const client = await pool.connect();
      const deleted = {};

      try {
        await client.query("BEGIN");

        if (
          (await tableExists(client, "billing_session_scans")) &&
          (await tableExists(client, "billing_sessions"))
        ) {
          const r = await client.query(
            `
            DELETE FROM billing_session_scans b
            USING billing_sessions s
            WHERE b.session_id = s.id
              AND s.store_id = $1
            `,
            [storeId]
          );
          deleted.billing_session_scans = r.rowCount || 0;
        }

        if (await tableExists(client, "billing_sessions")) {
          const r = await client.query(
            `DELETE FROM billing_sessions WHERE store_id = $1`,
            [storeId]
          );
          deleted.billing_sessions = r.rowCount || 0;
        }

        if (
          (await tableExists(client, "inventory_scans")) &&
          (await tableExists(client, "inventory_sessions"))
        ) {
          const r = await client.query(
            `
            DELETE FROM inventory_scans i
            USING inventory_sessions s
            WHERE i.session_id = s.id
              AND s.store_id = $1
            `,
            [storeId]
          );
          deleted.inventory_scans = r.rowCount || 0;
        }

        if (await tableExists(client, "inventory_sessions")) {
          const r = await client.query(
            `DELETE FROM inventory_sessions WHERE store_id = $1`,
            [storeId]
          );
          deleted.inventory_sessions = r.rowCount || 0;
        }

        if (await tableExists(client, "scan_items")) {
          const r = await client.query(
            `DELETE FROM scan_items WHERE store_id = $1`,
            [storeId]
          );
          deleted.scan_items = r.rowCount || 0;
        }

        if (await tableExists(client, "scan_batches")) {
          const r = await client.query(
            `DELETE FROM scan_batches WHERE store_id = $1`,
            [storeId]
          );
          deleted.scan_batches = r.rowCount || 0;
        }

        if (await tableExists(client, "catalog_items")) {
          const catalogCols = await getTableColumns("catalog_items");
          if (catalogCols.has("store_id")) {
            const r = await client.query(
              `DELETE FROM catalog_items WHERE store_id = $1`,
              [storeId]
            );
            deleted.catalog_items = r.rowCount || 0;
          }
        }

        if (
          (await tableExists(client, "pos_transaction_items")) &&
          (await tableExists(client, "pos_transactions"))
        ) {
          const r = await client.query(
            `
            DELETE FROM pos_transaction_items pti
            USING pos_transactions pt
            WHERE pti.pos_txn_id = pt.id
              AND pt.store_id = $1
            `,
            [storeId]
          );
          deleted.pos_transaction_items = r.rowCount || 0;
        }

        if (await tableExists(client, "pos_transactions")) {
          const r = await client.query(
            `DELETE FROM pos_transactions WHERE store_id = $1`,
            [storeId]
          );
          deleted.pos_transactions = r.rowCount || 0;
        }

        if (await tableExists(client, "tag_events")) {
          const tagEventCols = await getTableColumns("tag_events");
          let r = null;
          if (tagEventCols.has("source") && tagEventCols.has("data")) {
            r = await client.query(
              `
              DELETE FROM tag_events
              WHERE source = $1
                 OR COALESCE(data->>'store_id', '') = $1
              `,
              [storeId]
            );
          } else if (tagEventCols.has("source")) {
            r = await client.query(
              `DELETE FROM tag_events WHERE source = $1`,
              [storeId]
            );
          } else if (tagEventCols.has("data")) {
            r = await client.query(
              `DELETE FROM tag_events WHERE COALESCE(data->>'store_id', '') = $1`,
              [storeId]
            );
          }
          if (r) {
            deleted.tag_events = r.rowCount || 0;
          }
        }

        if (await tableExists(client, "alert_cases")) {
          if (
            (await tableExists(client, "alert_case_events")) &&
            (await tableExists(client, "alert_cases"))
          ) {
            const rEvents = await client.query(
              `
              DELETE FROM alert_case_events e
              USING alert_cases c
              WHERE e.case_id = c.id
                AND c.store_id = $1
              `,
              [storeId]
            );
            deleted.alert_case_events = rEvents.rowCount || 0;
          }

          const rCases = await client.query(
            `DELETE FROM alert_cases WHERE store_id = $1`,
            [storeId]
          );
          deleted.alert_cases = rCases.rowCount || 0;
        }

        if (await tableExists(client, "alerts")) {
          const alertCols = await getTableColumns("alerts");
          if (alertCols.has("store_id")) {
            const r = await client.query(
              `DELETE FROM alerts WHERE store_id = $1`,
              [storeId]
            );
            deleted.alerts = r.rowCount || 0;
          } else if (alertCols.has("source")) {
            const r = await client.query(
              `DELETE FROM alerts WHERE source = $1`,
              [storeId]
            );
            deleted.alerts = r.rowCount || 0;
          }
        }

        await client.query("COMMIT");
        deleted.recent_events = clearRecentEvents();

        return res.json({
          ok: true,
          store_id: storeId,
          deleted,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[admin/operations/clear-logs]", e);
        return res.status(500).json({
          ok: false,
          error: "Failed to clear operational logs",
        });
      } finally {
        client.release();
      }
    }
  );

  /* =========================================================
     AUDIT LOGS
  ========================================================= */

  router.get("/audit", authenticate, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const logs = await loadAuditLogs({ limit, offset });

      res.json({
        ok: true,
        logs,
      });
    } catch (e) {
      console.error("[admin/audit]", e);
      res.status(500).json({
        ok: false,
        error: "Failed to load audit logs",
      });
    }
  });

  return router;
};
