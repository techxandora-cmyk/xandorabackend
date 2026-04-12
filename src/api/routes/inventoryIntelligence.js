console.log("🔥 INVENTORY INTELLIGENCE ROUTES LOADED 🔥");

const express = require("express");
const jwt = require("jsonwebtoken");

module.exports = function buildInventoryIntelligenceRoutes(pool) {
  const router = express.Router();
  const STOCK_AUDIT_PRODUCT_KEY = "stock_audit";
  const STOCK_AUDIT_READ_PERMISSIONS = [
    "dashboard.view_stock_audit",
    "dashboard.manage_stock_audit",
    "handheld.inventory_count",
    "handheld.run_audits",
  ];

  /* =========================
     AUTH
  ========================= */
  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function isGlobalAdmin(req) {
    const roleList = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const singleRole = req.user?.role ? [req.user.role] : [];
    const roles = Array.from(
      new Set(
        [...roleList, ...singleRole]
          .map((r) => String(r || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function getAllowedStores(req) {
    return Array.isArray(req.user?.store_ids) ? req.user.store_ids : [];
  }

  function canAccessStore(req, storeId) {
    if (!storeId) return false;
    if (isGlobalAdmin(req)) return true;

    const allowedStores = getAllowedStores(req);
    if (!allowedStores.length) return false;
    return allowedStores.includes(storeId);
  }

  function normalizedProductKey(req) {
    return String(req.user?.product_key || "").trim().toLowerCase();
  }

  function permissionAliases(permission) {
    switch (String(permission || "").trim()) {
      case "dashboard.view_stock_audit":
        return ["dashboard.view_stock_audit", "dashboard.view_inventory", "dashboard.inventory"];
      case "dashboard.manage_stock_audit":
        return ["dashboard.manage_stock_audit"];
      case "handheld.inventory_count":
        return ["handheld.inventory_count", "handheld.inventory"];
      case "handheld.run_audits":
        return ["handheld.run_audits", "handheld.audit"];
      default:
        return [];
    }
  }

  function hasPermission(req, permission) {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    if (permissions.includes("*")) return true;
    if (permissions.includes(permission)) return true;
    return permissionAliases(permission).some((alias) => permissions.includes(alias));
  }

  function requireStockAuditProduct(req, res, next) {
    if (normalizedProductKey(req) === STOCK_AUDIT_PRODUCT_KEY) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      error: "Xandora Stock Audit access required",
    });
  }

  function requireReadPermission(req, res, next) {
    if (isGlobalAdmin(req)) {
      return next();
    }

    const allowed = STOCK_AUDIT_READ_PERMISSIONS.some((permission) =>
      hasPermission(req, permission)
    );

    if (allowed) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      error: "Stock Audit permission required",
    });
  }

  router.use(authenticate);
  router.use(requireStockAuditProduct);
  router.use(requireReadPermission);

  /* =========================================================
     REPEATED MISSING EPCs
     GET /api/v1/inventory/intelligence/missing
     query: store_id, min_sessions (default 2)
  ========================================================= */
  router.get("/missing", async (req, res) => {
    try {
      const store_id = req.query.store_id;
      const minSessions = Number(req.query.min_sessions || 2);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canAccessStore(req, String(store_id))) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const r = await pool.query(
        `
        SELECT
          sc.epc,
          COUNT(DISTINCT s.id)::int AS missed_sessions
        FROM inventory_sessions s
        JOIN inventory_scans sc ON sc.session_id = s.id
        WHERE
          s.store_id = $1
          AND s.status = 'ENDED'
          AND sc.read_count = 0
        GROUP BY sc.epc
        HAVING COUNT(DISTINCT s.id) >= $2
        ORDER BY missed_sessions DESC
        `,
        [store_id, minSessions]
      );

      return res.json({ ok: true, epcs: r.rows });
    } catch (err) {
      console.error("[inventory/intelligence/missing]", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch missing EPC intelligence",
      });
    }
  });

  /* =========================================================
     ACCURACY TREND
     GET /api/v1/inventory/intelligence/trend
     query: store_id
  ========================================================= */
  router.get("/trend", async (req, res) => {
    try {
      const store_id = req.query.store_id;

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canAccessStore(req, String(store_id))) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const r = await pool.query(
        `
        SELECT
          started_at::date AS day,
          ROUND(AVG(accuracy_percent),2)::numeric AS avg_accuracy
        FROM inventory_sessions
        WHERE
          store_id = $1
          AND status = 'ENDED'
        GROUP BY day
        ORDER BY day ASC
        `,
        [store_id]
      );

      return res.json({ ok: true, trend: r.rows });
    } catch (err) {
      console.error("[inventory/intelligence/trend]", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch inventory accuracy trend",
      });
    }
  });

  return router;
};
