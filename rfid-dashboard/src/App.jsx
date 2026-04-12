import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import AdminRoute from "@/routes/AdminRoute";
import PermissionRoute from "@/routes/PermissionRoute";
import ProductRoute from "@/routes/ProductRoute";
import { useAuth } from "@/context/AuthContext";

/* Pages */
const Login = lazy(() => import("@/pages/Login"));
const Overview = lazy(() => import("@/pages/Overview"));
const CheckoutOps = lazy(() => import("@/pages/CheckoutOps"));
const Billing = lazy(() => import("@/pages/Billing"));
const Devices = lazy(() => import("@/pages/Devices"));
const Scans = lazy(() => import("@/pages/Scans"));
const HandheldDevices = lazy(() => import("@/pages/HandheldDevices"));
const Laundry = lazy(() => import("@/pages/Laundry"));
const StockAudit = lazy(() => import("@/pages/StockAudit"));
const Stock = lazy(() => import("@/pages/Stock"));
const Alerts = lazy(() => import("@/pages/Alerts"));

/* Admin */
const AdminLayout = lazy(() => import("@/components/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const MasterAdminOverview = lazy(() => import("@/pages/MasterAdminOverview"));
const AdminUsers = lazy(() => import("@/components/admin/AdminUsers"));
const AdminStores = lazy(() => import("@/components/admin/AdminStores"));
const AdminAudit = lazy(() => import("@/components/admin/AdminAudit"));
const AdminAlerts = lazy(() => import("@/components/admin/AdminAlerts"));
const AdminContracts = lazy(() => import("@/components/admin/AdminContracts"));
const AdminRolePermissions = lazy(
  () => import("@/components/admin/AdminRolePermissions")
);
const AdminSoftwareAccess = lazy(
  () => import("@/components/admin/AdminSoftwareAccess")
);

function RouteLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/65">
        Loading Xandora workspace...
      </div>
    </div>
  );
}

function withRouteSuspense(children) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      {/* LOGIN */}
      <Route path="/login" element={withRouteSuspense(<Login />)} />

      {/* 🔒 MAIN LAYOUT — MUST HAVE PATH */}
      <Route path="/" element={<Layout />}>
        <Route index element={withRouteSuspense(<DefaultLanding />)} />
        <Route
          path="pos"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_pos", "dashboard.view_billing", "dashboard.view_recent_scans"]}>
                <CheckoutOps />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="billing"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_billing"]}>
                <Billing />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="devices"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_devices"]}>
                <Devices />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="scans"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_recent_scans"]}>
                <Scans />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="inventory"
          element={withRouteSuspense(<InventoryRedirect />)}
        />
        <Route
          path="laundry"
          element={withRouteSuspense(
            <ProductRoute anyOf={["laundry"]}>
              <PermissionRoute anyOf={["dashboard.view_laundry", "dashboard.manage_laundry"]}>
                <Laundry view="dashboard" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="laundry/inbound"
          element={withRouteSuspense(
            <ProductRoute anyOf={["laundry"]}>
              <PermissionRoute anyOf={["dashboard.view_laundry", "dashboard.manage_laundry"]}>
                <Laundry view="inbound" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="laundry/outbound"
          element={withRouteSuspense(
            <ProductRoute anyOf={["laundry"]}>
              <PermissionRoute anyOf={["dashboard.view_laundry", "dashboard.manage_laundry"]}>
                <Laundry view="outbound" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="laundry/data-entry"
          element={withRouteSuspense(
            <ProductRoute anyOf={["laundry"]}>
              <PermissionRoute anyOf={["dashboard.view_laundry", "dashboard.manage_laundry"]}>
                <Laundry view="data_entry" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="laundry/devices"
          element={withRouteSuspense(
            <ProductRoute anyOf={["laundry"]}>
              <PermissionRoute anyOf={["dashboard.view_laundry", "dashboard.manage_laundry"]}>
                <HandheldDevices moduleKey="laundry" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="stock-audit"
          element={withRouteSuspense(
            <ProductRoute anyOf={["stock_audit"]}>
              <PermissionRoute anyOf={["dashboard.view_stock_audit", "dashboard.manage_stock_audit"]}>
                <StockAudit view="dashboard" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="stock-audit/sessions"
          element={withRouteSuspense(
            <ProductRoute anyOf={["stock_audit"]}>
              <PermissionRoute anyOf={["dashboard.view_stock_audit", "dashboard.manage_stock_audit"]}>
                <StockAudit view="sessions" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="stock-audit/findings"
          element={withRouteSuspense(
            <ProductRoute anyOf={["stock_audit"]}>
              <PermissionRoute anyOf={["dashboard.view_stock_audit", "dashboard.manage_stock_audit"]}>
                <StockAudit view="findings" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="stock-audit/devices"
          element={withRouteSuspense(
            <ProductRoute anyOf={["stock_audit"]}>
              <PermissionRoute anyOf={["dashboard.view_stock_audit", "dashboard.manage_stock_audit"]}>
                <HandheldDevices moduleKey="stock_audit" />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="stock"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_stock"]}>
                <Stock />
              </PermissionRoute>
            </ProductRoute>
          )}
        />
        <Route
          path="alerts"
          element={withRouteSuspense(
            <ProductRoute anyOf={["retail"]}>
              <PermissionRoute anyOf={["dashboard.view_alerts"]}>
                <Alerts />
              </PermissionRoute>
            </ProductRoute>
          )}
        />

        {/* 🔥 ADMIN */}
        <Route
          element={withRouteSuspense(
            <ProductRoute anyOf={["portal"]}>
              <AdminRoute />
            </ProductRoute>
          )}
        >
          <Route path="admin" element={withRouteSuspense(<AdminLayout />)}>
            <Route
              index
              element={withRouteSuspense(
                <PermissionRoute
                  anyOf={[
                    "dashboard.manage_users",
                    "dashboard.manage_roles",
                    "dashboard.view_alerts",
                    "dashboard.view_audit_logs",
                  ]}
                >
                  <AdminPortalHome />
                </PermissionRoute>
              )}
            />
            <Route
              path="users"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.manage_users"]}>
                  <AdminUsers />
                </PermissionRoute>
              )}
            />
            <Route
              path="stores"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.manage_users"]}>
                  <AdminStores />
                </PermissionRoute>
              )}
            />
            <Route
              path="software"
              element={withRouteSuspense(
                <PermissionRoute masterAdminOnly>
                  <AdminSoftwareAccess />
                </PermissionRoute>
              )}
            />
            <Route
              path="roles"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.manage_roles"]}>
                  <AdminRolePermissions />
                </PermissionRoute>
              )}
            />
            <Route
              path="alerts"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.view_alerts", "dashboard.manage_users"]}>
                  <AdminAlerts />
                </PermissionRoute>
              )}
            />
            <Route
              path="contracts"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.manage_users"]}>
                  <AdminContracts />
                </PermissionRoute>
              )}
            />
            <Route
              path="audit"
              element={withRouteSuspense(
                <PermissionRoute anyOf={["dashboard.view_audit_logs"]}>
                  <AdminAudit />
                </PermissionRoute>
              )}
            />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

function DefaultLanding() {
  const {
    loading,
    isAuthenticated,
    hasPermission,
    productKey,
    canAccessAdminUI,
  } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (productKey === "portal") {
    if (canAccessAdminUI) {
      return <Navigate to="/admin" replace />;
    }
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        This account does not have access to the Xandora Admin Portal.
      </div>
    );
  }

  if (productKey === "laundry") {
    if (hasPermission("dashboard.view_laundry") || hasPermission("dashboard.manage_laundry")) {
      return <Navigate to="/laundry" replace />;
    }
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        This account is not allowed to open Xandora Laundry.
      </div>
    );
  }

  if (productKey === "stock_audit") {
    if (
      hasPermission("dashboard.view_stock_audit") ||
      hasPermission("dashboard.manage_stock_audit")
    ) {
      return <Navigate to="/stock-audit" replace />;
    }
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        This account is not allowed to open Xandora Stock Audit.
      </div>
    );
  }

  if (hasPermission("dashboard.view_overview")) {
    return <Overview />;
  }

  const canAccessCheckoutOps =
    hasPermission("dashboard.view_pos") ||
    hasPermission("dashboard.view_billing") ||
    hasPermission("dashboard.view_recent_scans");

  if (canAccessCheckoutOps) {
    return <Navigate to="/pos" replace />;
  }

  const firstAllowed =
    [
      ["devices", "dashboard.view_devices"],
      ["scans", "dashboard.view_recent_scans"],
      ["stock", "dashboard.view_stock"],
      ["pos", "dashboard.view_pos"],
      ["billing", "dashboard.view_billing"],
      ["alerts", "dashboard.view_alerts"],
    ].find(([, perm]) => (typeof perm === "boolean" ? perm : hasPermission(perm))) || null;

  if (firstAllowed) {
    return <Navigate to={`/${firstAllowed[0]}`} replace />;
  }

  return (
    <div className="rounded border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
      No sections are assigned to this account yet.
    </div>
  );
}

function AdminPortalHome() {
  const { isMasterAdmin } = useAuth();

  if (isMasterAdmin) {
    return <MasterAdminOverview />;
  }

  return <AdminDashboard />;
}

function InventoryRedirect() {
  const { loading, isAuthenticated, productKey, hasPermission } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const canViewStock = hasPermission("dashboard.view_stock");
  const canViewStockAudit =
    hasPermission("dashboard.view_stock_audit") ||
    hasPermission("dashboard.manage_stock_audit");

  if (productKey === "stock_audit" && canViewStockAudit) {
    return <Navigate to="/stock-audit/sessions" replace />;
  }

  if (productKey === "retail" && canViewStock) {
    return <Navigate to="/stock" replace />;
  }

  if (canViewStockAudit) {
    return <Navigate to="/stock-audit/sessions" replace />;
  }

  if (canViewStock) {
    return <Navigate to="/stock" replace />;
  }

  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      Inventory counting now lives inside Xandora Stock Audit. Use Stock for visibility and search.
    </div>
  );
}
