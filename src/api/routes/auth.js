const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
  normalizeProductKey,
  ensureProductAccessTables,
  getEnabledCompanyProducts,
  getEnabledUserProducts,
} = require("./lib/productAccess");

const PERMISSION_RENAMES = {
  "dashboard.view_inventory": "dashboard.view_stock_audit",
};

const MASTER_ADMIN_PERMISSIONS = [
  "dashboard.view_overview",
  "dashboard.view_pos",
  "dashboard.view_billing",
  "dashboard.view_recent_scans",
  "dashboard.view_devices",
  "dashboard.view_stock",
  "dashboard.view_alerts",
  "dashboard.manage_users",
  "dashboard.manage_roles",
  "dashboard.view_audit_logs",
  "dashboard.view_laundry",
  "dashboard.manage_laundry",
  "dashboard.view_stock_audit",
  "dashboard.manage_stock_audit",
  "handheld.scan_items",
  "handheld.inventory_count",
  "handheld.laundry_scan",
  "handheld.run_audits",
];

function productDisplayName(productKey) {
  switch (String(productKey || "").trim().toLowerCase()) {
    case "portal":
      return "Xandora Admin Portal";
    case "retail":
      return "Xandora Retail";
    case "laundry":
      return "Xandora Laundry";
    case "stock_audit":
      return "Xandora Stock Audit";
    default:
      return "Xandora software";
  }
}

const DEFAULT_ROLE_PERMISSIONS = {
  MASTER_ADMIN: MASTER_ADMIN_PERMISSIONS,
  ADMIN: ["*"],
  STORE_MANAGER: [
    "dashboard.view_overview",
    "dashboard.view_pos",
    "dashboard.view_billing",
    "dashboard.view_recent_scans",
    "dashboard.view_devices",
    "dashboard.view_stock",
    "dashboard.view_alerts",
    "dashboard.view_laundry",
    "dashboard.manage_laundry",
    "dashboard.view_stock_audit",
    "dashboard.manage_stock_audit",
    "handheld.scan_items",
    "handheld.inventory_count",
    "handheld.laundry_scan",
    "handheld.run_audits",
  ],
  STORE_STAFF: [
    "dashboard.view_overview",
    "dashboard.view_pos",
    "dashboard.view_recent_scans",
    "dashboard.view_devices",
    "dashboard.view_laundry",
    "dashboard.view_stock_audit",
    "handheld.scan_items",
    "handheld.run_audits",
  ],
  HANDHELD_USER: [
    "handheld.scan_items",
    "handheld.inventory_count",
    "handheld.laundry_scan",
    "handheld.run_audits",
  ],
};

const ADMIN_MIN_PERMISSIONS = [
  "dashboard.view_overview",
  "dashboard.view_pos",
  "dashboard.view_billing",
  "dashboard.view_recent_scans",
  "dashboard.view_devices",
  "dashboard.view_stock",
  "dashboard.view_alerts",
  "dashboard.view_laundry",
  "dashboard.manage_laundry",
  "dashboard.view_stock_audit",
  "dashboard.manage_stock_audit",
  "dashboard.manage_users",
  "dashboard.manage_roles",
  "dashboard.view_audit_logs",
];

async function ensureCompanyRolePermissionsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions_company (
      company_name TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_name, role)
    )
  `);
}

async function tableExists(pool, tableName) {
  const r = await pool.query(`SELECT to_regclass($1) AS regclass_name`, [
    `public.${tableName}`,
  ]);
  return Boolean(r.rows[0]?.regclass_name);
}

async function ensureCustomerPaymentAlertsBlockingColumns(pool) {
  const exists = await tableExists(pool, "customer_payment_alerts");
  if (!exists) return false;

  try {
    await pool.query(`
      ALTER TABLE customer_payment_alerts
      ADD COLUMN IF NOT EXISTS block_on_due BOOLEAN NOT NULL DEFAULT FALSE
    `);
    return true;
  } catch (e) {
    console.warn("[auth/login] failed to ensure block_on_due column:", e.message);
    return true;
  }
}

async function findActivePaymentBlock(pool, companyName) {
  const normalizedCompanyName = String(companyName || "").trim();
  if (!normalizedCompanyName) return null;
  if (normalizedCompanyName.toUpperCase() === "XANDORA") return null;

  const ready = await ensureCustomerPaymentAlertsBlockingColumns(pool);
  if (!ready) return null;

  try {
    const r = await pool.query(
      `
      SELECT
        id,
        title,
        due_date
      FROM customer_payment_alerts
      WHERE company_name = $1
        AND status = 'OPEN'
        AND COALESCE(block_on_due, FALSE) = TRUE
        AND due_date IS NOT NULL
        AND due_date <= CURRENT_DATE
      ORDER BY due_date ASC, id ASC
      LIMIT 1
      `,
      [normalizedCompanyName]
    );

    return r.rows[0] || null;
  } catch (e) {
    console.warn("[auth/login] payment-block lookup failed:", e.message);
    return null;
  }
}

function normalizePermissionName(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return PERMISSION_RENAMES[value] || value;
}

function normalizePermissions(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((permission) => normalizePermissionName(permission))
        .filter(Boolean)
    )
  );
}

async function loadPermissionsByRole(pool, roles, companyName) {
  const roleList = Array.from(
    new Set(
      (Array.isArray(roles) ? roles : [])
        .map((r) => String(r || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const globalByRole = {};
  const companyByRole = {};

  if (!roleList.length) {
    return { globalByRole, companyByRole };
  }

  try {
    const globalRes = await pool.query(
      `
      SELECT role, permissions
      FROM role_permissions
      WHERE role = ANY($1::text[])
      `,
      [roleList]
    );

    for (const row of globalRes.rows) {
      globalByRole[String(row.role || "").toUpperCase()] = normalizePermissions(
        row.permissions
      );
    }
  } catch (e) {
    console.warn("[auth/login] role_permissions lookup failed:", e.message);
  }

  if (companyName) {
    try {
      await ensureCompanyRolePermissionsTable(pool);

      const companyRes = await pool.query(
        `
        SELECT role, permissions
        FROM role_permissions_company
        WHERE company_name = $1
          AND role = ANY($2::text[])
        `,
        [companyName, roleList]
      );

      for (const row of companyRes.rows) {
        companyByRole[String(row.role || "").toUpperCase()] = normalizePermissions(
          row.permissions
        );
      }
    } catch (e) {
      console.warn(
        "[auth/login] role_permissions_company lookup failed:",
        e.message
      );
    }
  }

  return { globalByRole, companyByRole };
}

function resolvePermissions({ roles, companyByRole, globalByRole }) {
  const normalizedRoles = Array.from(
    new Set(
      (Array.isArray(roles) ? roles : [])
        .map((r) => String(r || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedRoles.includes("MASTER_ADMIN")) {
    // MASTER_ADMIN stays platform/global focused and does not get store checkout permissions.
    return Array.from(new Set(MASTER_ADMIN_PERMISSIONS));
  }

  const perms = new Set();

  for (const role of normalizedRoles) {
    const companyPerms = companyByRole[role];
    const globalPerms = globalByRole[role];
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role] || [];
    const sourcePerms =
      Array.isArray(companyPerms) && companyPerms.length
        ? companyPerms
        : Array.isArray(globalPerms) && globalPerms.length
        ? globalPerms
        : defaultPerms;

    sourcePerms
      .map((permission) => normalizePermissionName(permission))
      .filter(Boolean)
      .forEach((permission) => perms.add(permission));
  }

  // Company admin must always retain core admin capabilities.
  if (normalizedRoles.includes("ADMIN")) {
    ADMIN_MIN_PERMISSIONS.forEach((p) => perms.add(p));
  }

  return perms.has("*") ? ["*"] : Array.from(perms);
}

module.exports = function buildAuthRoutes(pool) {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    if (!process.env.JWT_SECRET) {
      console.error("[auth/login] JWT_SECRET is not set — cannot issue tokens");
      return res.status(500).json({ ok: false, error: "Server misconfiguration: JWT_SECRET missing" });
    }

    try {
      const { email, password } = req.body;
      const productKey = normalizeProductKey(req.body?.product_key);

      if (!productKey) {
        return res.status(400).json({
          ok: false,
          error: "Select the Xandora software you want to open.",
        });
      }

      const userResult = await pool.query(
        `
        SELECT id, email, password_hash, is_active, company_name
        FROM users
        WHERE email = $1
        `,
        [String(email || "").toLowerCase()]
      );

      if (!userResult.rowCount) {
        return res.status(401).json({ ok: false });
      }

      const user = userResult.rows[0];

      if (user.is_active === false) {
        return res.status(403).json({
          ok: false,
          error: "Account disabled",
        });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ ok: false });
      }

      const access = await pool.query(
        `
        SELECT store_id, role
        FROM user_store_roles
        WHERE user_id = $1
        `,
        [user.id]
      );

      let roles = access.rows.map((r) => String(r.role || "").toUpperCase());
      roles = Array.from(new Set(roles));

      let store_ids = Array.from(
        new Set(
          access.rows
            .map((r) => r.store_id)
            .filter((id) => id && id !== "_GLOBAL_")
        )
      );

      const companyName = user.company_name ? String(user.company_name) : null;
      const normalizedCompanyName = String(companyName || "").trim();

      const paymentBlock = await findActivePaymentBlock(pool, companyName);
      if (paymentBlock) {
        return res.status(403).json({
          ok: false,
          error: `Account blocked due to overdue payment alert (due ${String(
            paymentBlock.due_date || ""
          ).slice(0, 10)}).`,
        });
      }

      if (roles.includes("MASTER_ADMIN")) {
        roles = ["MASTER_ADMIN"];
        // Preserve any explicit store assignments so master admins can test
        // store-scoped handheld and retail flows without losing portal access.
      } else if (roles.includes("ADMIN") && companyName) {
        // Keep ADMIN scope aligned to active company stores to avoid stale store ids.
        let scopedStoreIds = [];

        try {
          if (await tableExists(pool, "company_stores")) {
            const companyStores = await pool.query(
              `
              SELECT store_id
              FROM company_stores
              WHERE company_name = $1
                AND is_active = TRUE
              ORDER BY store_id
              `,
              [companyName]
            );

            scopedStoreIds = companyStores.rows
              .map((r) => String(r.store_id || "").trim())
              .filter(Boolean);
          }
        } catch (e) {
          console.warn("[auth/login] company_stores lookup failed:", e.message);
        }

        if (!scopedStoreIds.length) {
          // Fallback for legacy schemas without company_stores.
          const companyStoresFromRoles = await pool.query(
            `
            SELECT DISTINCT usr.store_id
            FROM users u
            JOIN user_store_roles usr
              ON usr.user_id = u.id
            WHERE u.company_name = $1
              AND usr.store_id <> '_GLOBAL_'
            ORDER BY usr.store_id
            `,
            [companyName]
          );

          scopedStoreIds = companyStoresFromRoles.rows
            .map((r) => String(r.store_id || "").trim())
            .filter(Boolean);
        }

        if (scopedStoreIds.length) {
          store_ids = Array.from(new Set(scopedStoreIds));
        }
      }

      await ensureProductAccessTables(pool);
      const userProducts = await getEnabledUserProducts(pool, user.id);

      if (roles.includes("MASTER_ADMIN")) {
        if (!userProducts.includes(productKey)) {
          return res.status(403).json({
            ok: false,
            error: `This master admin account is not assigned to ${productDisplayName(
              productKey
            )}.`,
          });
        }
      } else if (productKey === "portal") {
        if (!roles.includes("ADMIN")) {
          return res.status(403).json({
            ok: false,
            error: "This account does not have portal access.",
          });
        }
        if (!userProducts.includes("portal")) {
          return res.status(403).json({
            ok: false,
            error: "This account is not assigned to Xandora Admin Portal.",
          });
        }
      } else {
        if (!normalizedCompanyName) {
          return res.status(403).json({
            ok: false,
            error: "This account is not linked to a customer company.",
          });
        }

        const companyProducts = await getEnabledCompanyProducts(
          pool,
          normalizedCompanyName
        );

        if (!companyProducts.includes(productKey)) {
          return res.status(403).json({
            ok: false,
            error: `This company has not purchased ${productDisplayName(productKey)}.`,
          });
        }

        if (!userProducts.includes(productKey)) {
          return res.status(403).json({
            ok: false,
            error: `This account is not assigned to ${productDisplayName(productKey)}.`,
          });
        }
      }

      const { globalByRole, companyByRole } = await loadPermissionsByRole(
        pool,
        roles,
        companyName
      );

      const permissions = resolvePermissions({
        roles,
        companyByRole,
        globalByRole,
      });

      const token = jwt.sign(
        {
          user_id: user.id,
          email: user.email,
          company_name: companyName,
          roles,
          permissions,
          product_key: productKey,
          store_ids,
          default_store_id: store_ids[0] || null,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
      );

      return res.json({ ok: true, token });
    } catch (e) {
      console.error("[auth/login]", e);
      return res.status(500).json({ ok: false });
    }
  });

  return router;
};
