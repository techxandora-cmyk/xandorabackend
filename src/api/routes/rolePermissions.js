const express = require("express");
const jwt = require("jsonwebtoken");

const MANAGED_ROLES = ["ADMIN", "STORE_MANAGER", "STORE_STAFF", "HANDHELD_USER"];
const PERMISSION_RENAMES = {
  "dashboard.view_inventory": "dashboard.view_stock_audit",
};

module.exports = function buildRolePermissionsRoutes(pool) {
  const router = express.Router();

  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }
  }

  function requireAdmin(req, res, next) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (roles.includes("MASTER_ADMIN") || roles.includes("ADMIN")) {
      return next();
    }
    return res.status(403).json({ error: "forbidden" });
  }

  async function ensureCompanyRolePermissionsTable() {
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

  async function getRequesterCompany(req) {
    const tokenCompany = String(req.user?.company_name || "").trim();
    if (tokenCompany) return tokenCompany;

    const userId = Number(req.user?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) return "";

    const r = await pool.query(`SELECT company_name FROM users WHERE id = $1`, [
      userId,
    ]);
    return String(r.rows[0]?.company_name || "").trim();
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

  router.use(authenticate);
  router.use(requireAdmin);

  router.get("/", async (req, res) => {
    try {
      await ensureCompanyRolePermissionsTable();

      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const isMasterAdmin = roles.includes("MASTER_ADMIN");
      const requesterCompany = await getRequesterCompany(req);
      const targetCompany = isMasterAdmin
        ? String(req.query.company_name || requesterCompany || "").trim()
        : requesterCompany;

      if (!targetCompany) {
        return res.status(400).json({ error: "company_required" });
      }

      const [companyRes, globalRes] = await Promise.all([
        pool.query(
          `
          SELECT role, permissions
          FROM role_permissions_company
          WHERE company_name = $1
          `,
          [targetCompany]
        ),
        pool.query(
          `
          SELECT role, permissions
          FROM role_permissions
          `,
          []
        ),
      ]);

      const out = {};
      for (const role of MANAGED_ROLES) {
        out[role] = [];
      }

      for (const row of globalRes.rows) {
        const role = String(row.role || "").toUpperCase();
        if (!MANAGED_ROLES.includes(role)) continue;
        out[role] = normalizePermissions(row.permissions);
      }

      for (const row of companyRes.rows) {
        const role = String(row.role || "").toUpperCase();
        if (!MANAGED_ROLES.includes(role)) continue;
        out[role] = normalizePermissions(row.permissions);
      }

      return res.json({
        ok: true,
        company_name: targetCompany,
        permissions: out,
      });
    } catch (e) {
      console.error("[role-permissions GET] failed", e);
      return res.status(500).json({ error: "failed_to_load" });
    }
  });

  router.put("/:role", async (req, res) => {
    const role = String(req.params.role || "").trim().toUpperCase();
    const permissions = normalizePermissions(req.body?.permissions);

    if (!MANAGED_ROLES.includes(role)) {
      return res.status(400).json({ error: "invalid_role" });
    }

    if (!Array.isArray(req.body?.permissions)) {
      return res.status(400).json({ error: "permissions_must_be_array" });
    }

    try {
      await ensureCompanyRolePermissionsTable();

      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const isMasterAdmin = roles.includes("MASTER_ADMIN");
      const requesterCompany = await getRequesterCompany(req);
      const targetCompany = isMasterAdmin
        ? String(
            req.body?.company_name ||
              req.query?.company_name ||
              requesterCompany ||
              ""
          ).trim()
        : requesterCompany;

      if (!targetCompany) {
        return res.status(400).json({ error: "company_required" });
      }

      await pool.query(
        `
        INSERT INTO role_permissions_company (company_name, role, permissions, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (company_name, role)
        DO UPDATE SET
          permissions = EXCLUDED.permissions,
          updated_at = NOW()
        `,
        [targetCompany, role, JSON.stringify(permissions)]
      );

      return res.json({
        ok: true,
        company_name: targetCompany,
        role,
      });
    } catch (e) {
      console.error("[role-permissions PUT] failed", e);
      return res.status(500).json({ error: "failed_to_save" });
    }
  });

  return router;
};
