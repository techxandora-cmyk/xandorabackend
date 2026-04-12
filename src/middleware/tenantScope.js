const jwt = require("jsonwebtoken");

const GLOBAL_ADMIN_ROLES = new Set(["MASTER_ADMIN", "ADMIN", "GLOBAL_ADMIN"]);

function normalizeRoles(user) {
  const roleList = Array.isArray(user?.roles) ? user.roles : [];
  const singleRole = user?.role ? [user.role] : [];

  return Array.from(
    new Set(
      [...roleList, ...singleRole]
        .map((role) => String(role || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

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

function authenticateJwt(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

function attachTenantScope(pool) {
  return async (req, res, next) => {
    try {
      const roles = normalizeRoles(req.user);
      const isGlobalAdmin = roles.some((role) => GLOBAL_ADMIN_ROLES.has(role));
      const allowedStoreIds = normalizeStoreIds(req.user?.store_ids);
      let companyName = String(req.user?.company_name || "").trim();
      const userId = Number(req.user?.user_id);

      if (!companyName && Number.isInteger(userId) && userId > 0) {
        const companyResult = await pool.query(
          `SELECT company_name FROM users WHERE id = $1`,
          [userId]
        );
        companyName = String(companyResult.rows[0]?.company_name || "").trim();
      }

      req.tenant = {
        user_id: Number.isInteger(userId) && userId > 0 ? userId : null,
        email: String(req.user?.email || "").trim().toLowerCase() || null,
        roles,
        is_global_admin: isGlobalAdmin,
        company_name: companyName || null,
        store_ids: allowedStoreIds,
      };

      return next();
    } catch (err) {
      console.error("[tenant-scope] failed to resolve request scope", err);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to resolve tenant scope" });
    }
  };
}

function resolveStoreScope(req, requestedStoreId) {
  const tenant = req.tenant || {};
  const requested = requestedStoreId ? String(requestedStoreId).trim() : "";
  const allowedStores = Array.isArray(tenant.store_ids) ? tenant.store_ids : [];

  if (requested) {
    if (tenant.is_global_admin || allowedStores.includes(requested)) {
      return {
        ok: true,
        store_ids: [requested],
        requested_store_id: requested,
      };
    }

    return {
      ok: false,
      status: 403,
      error: `Forbidden: no access to store ${requested}`,
    };
  }

  if (tenant.is_global_admin) {
    return {
      ok: true,
      store_ids: null,
      requested_store_id: null,
    };
  }

  if (allowedStores.length) {
    return {
      ok: true,
      store_ids: allowedStores,
      requested_store_id: null,
    };
  }

  return {
    ok: false,
    status: 403,
    error: "Forbidden: no store access",
  };
}

module.exports = {
  authenticateJwt,
  attachTenantScope,
  resolveStoreScope,
};
