/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

const AuthContext = createContext(null);
const PERMISSION_ALIASES = {
  "dashboard.view_overview": ["dashboard.view_metrics"],
  "dashboard.view_pos": ["dashboard.scans"],
  "dashboard.view_billing": ["dashboard.scans"],
  "dashboard.view_recent_scans": ["dashboard.scans", "dashboard.view_recent_scans"],
  "dashboard.view_devices": ["dashboard.devices.view", "dashboard.view_devices"],
  "dashboard.view_stock": ["dashboard.view_stock"],
  "dashboard.view_alerts": ["dashboard.alerts", "dashboard.view_alerts"],
  "dashboard.view_laundry": ["dashboard.view_laundry"],
  "dashboard.manage_laundry": ["dashboard.manage_laundry"],
  "dashboard.view_stock_audit": [
    "dashboard.view_stock_audit",
    "dashboard.view_inventory",
    "dashboard.inventory",
  ],
  "dashboard.manage_stock_audit": ["dashboard.manage_stock_audit"],
  "dashboard.view_audit_logs": ["dashboard.audit", "dashboard.view_audit_logs"],
  "dashboard.manage_users": ["dashboard.manage_users"],
  "dashboard.manage_roles": ["dashboard.manage_roles"],
  "handheld.scan": ["handheld.scan_items", "handheld.scan"],
  "handheld.scan_items": ["handheld.scan_items", "handheld.scan"],
  "handheld.inventory": ["handheld.inventory_count", "handheld.inventory"],
  "handheld.inventory_count": ["handheld.inventory_count", "handheld.inventory"],
  "handheld.laundry_scan": ["handheld.laundry_scan"],
  "handheld.audit": ["handheld.run_audits", "handheld.audit"],
  "handheld.run_audits": ["handheld.run_audits", "handheld.audit"],
};
const MASTER_ADMIN_SCOPED_PERMISSIONS = new Set([
  "dashboard.view_pos",
  "dashboard.view_billing",
  "dashboard.view_recent_scans",
  "dashboard.scans",
  "dashboard.view_devices",
  "dashboard.view_stock",
  "dashboard.view_alerts",
  "dashboard.view_laundry",
  "dashboard.manage_laundry",
  "dashboard.view_stock_audit",
  "dashboard.manage_stock_audit",
]);

function normalizeCompanyView(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (
    upper === "GLOBAL" ||
    upper === "GLOBAL_VIEW" ||
    upper === "GLOBAL VIEW" ||
    upper === "XANDORA"
  ) {
    return "";
  }
  return value;
}

/* =========================
   Helpers
========================= */

// Decode JWT payload safely
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [companyView, setCompanyView] = useState(() =>
    normalizeCompanyView(localStorage.getItem("zyro_company_view") || "")
  );

  /* =========================
     Restore session
  ========================= */
  useEffect(() => {
    const storedToken =
      localStorage.getItem("zyro_jwt") ??
      sessionStorage.getItem("zyro_jwt");

    if (!storedToken) {
      setLoading(false);
      return;
    }

    const decoded = decodeJwt(storedToken);
    if (!decoded) {
      logout();
      setLoading(false);
      return;
    }

    const restoredUser = {
      user_id: decoded.user_id,
      email: decoded.email,
      company_name: decoded.company_name || null,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
      product_key: decoded.product_key || "retail",
      store_ids: decoded.store_ids || [],
      default_store_id: decoded.default_store_id || null,
    };

    setToken(storedToken);
    setUser(restoredUser);
    setLoading(false);
  }, []);

  useEffect(() => {
    function syncCompanyView() {
      const normalized = normalizeCompanyView(
        localStorage.getItem("zyro_company_view") || ""
      );
      setCompanyView((prev) => (prev === normalized ? prev : normalized));
    }

    window.addEventListener("storage", syncCompanyView);
    window.addEventListener("zyro_company_view_changed", syncCompanyView);
    return () => {
      window.removeEventListener("storage", syncCompanyView);
      window.removeEventListener("zyro_company_view_changed", syncCompanyView);
    };
  }, []);

  /* =========================
     Set auth after login
  ========================= */
  function setAuth(_unused, token, remember = true) {
    if (!token) return;

    const decoded = decodeJwt(token);
    if (!decoded) return;

    const fullUser = {
      user_id: decoded.user_id,
      email: decoded.email,
      company_name: decoded.company_name || null,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
      product_key: decoded.product_key || "retail",
      store_ids: decoded.store_ids || [],
      default_store_id: decoded.default_store_id || null,
    };

    setUser(fullUser);
    setToken(token);

    // Prevent cross-account token leakage between remember/session modes.
    localStorage.removeItem("zyro_jwt");
    localStorage.removeItem("zyro_user");
    sessionStorage.removeItem("zyro_jwt");
    sessionStorage.removeItem("zyro_user");

    const store = remember ? localStorage : sessionStorage;
    store.setItem("zyro_jwt", token);
    store.setItem("zyro_user", JSON.stringify(fullUser));

    // Clear stale tenant/store switch state on new login.
    localStorage.removeItem("zyro_store_id");
    localStorage.removeItem("zyro_company_view");
    setCompanyView("");
  }

  /* =========================
     Logout
  ========================= */
  function logout() {
    setUser(null);
    setToken(null);

    localStorage.removeItem("zyro_jwt");
    localStorage.removeItem("zyro_user");
    localStorage.removeItem("zyro_store_id");
    localStorage.removeItem("zyro_company_view");
    sessionStorage.removeItem("zyro_jwt");
    sessionStorage.removeItem("zyro_user");
    setCompanyView("");

    window.location.href = "/login";
  }

  /* =========================
     Role helpers (FINAL)
  ========================= */
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];

  const isMasterAdmin = roles.includes("MASTER_ADMIN");
  const isAdmin = roles.includes("ADMIN");
  const productKey = String(user?.product_key || "retail").trim().toLowerCase();

  function permissionAliases(perm) {
    return PERMISSION_ALIASES[String(perm || "")] || [];
  }

  function isMasterScopedPermission(perm) {
    const normalizedPerm = String(perm || "");
    if (MASTER_ADMIN_SCOPED_PERMISSIONS.has(normalizedPerm)) return true;
    return permissionAliases(normalizedPerm).some((alias) =>
      MASTER_ADMIN_SCOPED_PERMISSIONS.has(String(alias))
    );
  }

  function hasPermission(perm) {
    if (!perm) return false;
    if (isMasterAdmin && isMasterScopedPermission(perm)) {
      // MASTER_ADMIN can access operational areas only when account switch scope is selected.
      return Boolean(companyView);
    }
    if (permissions.includes("*")) return true;
    if (permissions.includes(perm)) return true;
    const aliases = permissionAliases(perm);
    return aliases.some((alias) => permissions.includes(alias));
  }

  // Admin UI access (MASTER_ADMIN allowed, but distinct)
  const canAccessAdminUI = isMasterAdmin || isAdmin;

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!token,

    // role flags
    isMasterAdmin,
    isAdmin,
    canAccessAdminUI,
    hasPermission,
    permissions,
    productKey,

    store_ids: user?.store_ids || [],
    setAuth,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
