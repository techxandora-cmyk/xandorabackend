import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

function isInternalCompany(value) {
  return String(value || "").trim().toUpperCase() === "XANDORA";
}

function normalizeCompanyView(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "GLOBAL VIEW" || upper === "GLOBAL_VIEW" || upper === "GLOBAL") {
    return "";
  }
  if (isInternalCompany(value)) {
    return "";
  }
  return value;
}

function hasRole(user, expectedRole) {
  const target = String(expectedRole || "").trim().toUpperCase();
  if (!target) return false;
  const rows = Array.isArray(user?.roles) ? user.roles : [];
  return rows.some(
    (row) => String(row?.role || "").trim().toUpperCase() === target
  );
}

function assignedStoreCount(user) {
  const rows = Array.isArray(user?.roles) ? user.roles : [];
  return new Set(
    rows
      .map((row) => String(row?.store_id || "").trim())
      .filter((storeId) => Boolean(storeId) && storeId !== "_GLOBAL_")
  ).size;
}

function formatTime(value) {
  if (!value) return "--";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return "--";
  return new Date(ms).toLocaleString();
}

function maxTimestamp(a, b) {
  const aMs = Number.isFinite(Date.parse(String(a || "")))
    ? Date.parse(String(a))
    : 0;
  const bMs = Number.isFinite(Date.parse(String(b || "")))
    ? Date.parse(String(b))
    : 0;
  return aMs >= bMs ? a : b;
}

export default function MasterAdminOverview() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [companyView, setCompanyView] = useState(() =>
    normalizeCompanyView(localStorage.getItem("xandora_company_view") || "")
  );

  useEffect(() => {
    let disposed = false;

    async function loadSummary() {
      try {
        const [usersRes, storesRes] = await Promise.all([
          apiGet("/admin/users"),
          apiGet("/admin/stores?include_inactive=1"),
        ]);

        if (disposed) return;

        setUsers(Array.isArray(usersRes?.users) ? usersRes.users : []);
        setStores(Array.isArray(storesRes?.stores) ? storesRes.stores : []);
        setError("");
        setLastUpdatedAt(new Date().toISOString());
      } catch (e) {
        if (disposed) return;
        setError(e?.message || "Failed to load account summary");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    function syncCompanyScope() {
      setCompanyView(
        normalizeCompanyView(localStorage.getItem("xandora_company_view") || "")
      );
    }

    function syncAndReload() {
      syncCompanyScope();
      loadSummary();
    }

    loadSummary();

    const intervalId = setInterval(loadSummary, 15000);
    window.addEventListener("storage", syncCompanyScope);
    window.addEventListener("xandora_store_changed", syncAndReload);
    window.addEventListener("xandora_stores_updated", syncAndReload);
    window.addEventListener("xandora_company_view_changed", syncAndReload);

    return () => {
      disposed = true;
      clearInterval(intervalId);
      window.removeEventListener("storage", syncCompanyScope);
      window.removeEventListener("xandora_store_changed", syncAndReload);
      window.removeEventListener("xandora_stores_updated", syncAndReload);
      window.removeEventListener("xandora_company_view_changed", syncAndReload);
    };
  }, []);

  const customerUsers = useMemo(() => {
    return users.filter((user) => {
      const companyName = String(user?.company_name || "").trim();
      if (!companyName || isInternalCompany(companyName)) return false;
      if (hasRole(user, "MASTER_ADMIN")) return false;
      return true;
    });
  }, [users]);

  const customerStores = useMemo(() => {
    return stores.filter((store) => {
      const companyName = String(store?.company_name || "").trim();
      if (!companyName || isInternalCompany(companyName)) return false;
      return true;
    });
  }, [stores]);

  const companyRows = useMemo(() => {
    const byCompany = new Map();

    function ensure(companyNameRaw) {
      const companyName = String(companyNameRaw || "").trim() || "Unassigned";
      if (!byCompany.has(companyName)) {
        byCompany.set(companyName, {
          company_name: companyName,
          users_total: 0,
          users_active: 0,
          admin_accounts: 0,
          stores_total: 0,
          stores_active: 0,
          stores_inactive: 0,
          store_user_links: 0,
          updated_at: null,
        });
      }
      return byCompany.get(companyName);
    }

    for (const user of customerUsers) {
      const row = ensure(user?.company_name);
      row.users_total += 1;
      if (user?.is_active !== false) {
        row.users_active += 1;
      }
      if (hasRole(user, "ADMIN")) {
        row.admin_accounts += 1;
      }
    }

    for (const store of customerStores) {
      const row = ensure(store?.company_name);
      row.stores_total += 1;
      if (store?.is_active) {
        row.stores_active += 1;
      } else {
        row.stores_inactive += 1;
      }
      row.store_user_links += Math.max(0, Number(store?.user_count || 0));
      row.updated_at = maxTimestamp(row.updated_at, store?.updated_at);
    }

    const rows = Array.from(byCompany.values()).sort((a, b) =>
      a.company_name.localeCompare(b.company_name)
    );

    if (!companyView) return rows;
    return rows.filter((row) => row.company_name === companyView);
  }, [companyView, customerStores, customerUsers]);

  const scopedUsers = useMemo(() => {
    if (!companyView) return customerUsers;
    return customerUsers.filter(
      (user) => String(user?.company_name || "").trim() === companyView
    );
  }, [companyView, customerUsers]);

  const scopedStores = useMemo(() => {
    if (!companyView) return customerStores;
    return customerStores.filter(
      (store) => String(store?.company_name || "").trim() === companyView
    );
  }, [companyView, customerStores]);

  const recentAdminAccounts = useMemo(() => {
    return scopedUsers
      .filter((user) => hasRole(user, "ADMIN"))
      .slice()
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
      .slice(0, 8);
  }, [scopedUsers]);

  const summary = useMemo(() => {
    return {
      customers: companyRows.length,
      usersTotal: scopedUsers.length,
      usersActive: scopedUsers.filter((user) => user?.is_active !== false).length,
      adminAccounts: scopedUsers.filter((user) => hasRole(user, "ADMIN")).length,
      storesActive: scopedStores.filter((store) => store?.is_active).length,
      storesInactive: scopedStores.filter((store) => !store?.is_active).length,
    };
  }, [companyRows, scopedStores, scopedUsers]);

  if (loading) {
    return <div className="text-white/50">Loading account summary...</div>;
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Master Overview</h1>
            <p className="mt-1 text-xs text-white/60">
              Customer account governance summary for provisioning and health checks.
            </p>
          </div>

          <div className="text-right text-xs text-white/60">
            <div>
              Scope:{" "}
              <span className="font-semibold text-cyan-300">
                {companyView || "All customers"}
              </span>
            </div>
            <div>Updated: {formatTime(lastUpdatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Customers</div>
          <div className="text-2xl font-semibold">{summary.customers}</div>
        </div>
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Admin Accounts</div>
          <div className="text-2xl font-semibold">{summary.adminAccounts}</div>
        </div>
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Users</div>
          <div className="text-2xl font-semibold">{summary.usersTotal}</div>
        </div>
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Active Users</div>
          <div className="text-2xl font-semibold">{summary.usersActive}</div>
        </div>
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Active Stores</div>
          <div className="text-2xl font-semibold text-emerald-300">
            {summary.storesActive}
          </div>
        </div>
        <div className="glass rounded-xl border p-4">
          <div className="text-[11px] text-white/60">Inactive Stores</div>
          <div className="text-2xl font-semibold text-amber-300">
            {summary.storesInactive}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl border p-4">
        <div className="mb-3 text-sm font-semibold">Customer Companies</div>
        {companyRows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-white/55">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-2">Company</th>
                  <th className="px-2 py-2">Admins</th>
                  <th className="px-2 py-2">Users</th>
                  <th className="px-2 py-2">Active Users</th>
                  <th className="px-2 py-2">Stores</th>
                  <th className="px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {companyRows.map((row) => (
                  <tr key={row.company_name} className="border-b border-white/5">
                    <td className="px-2 py-2 font-medium">{row.company_name}</td>
                    <td className="px-2 py-2">{row.admin_accounts}</td>
                    <td className="px-2 py-2">{row.users_total}</td>
                    <td className="px-2 py-2">{row.users_active}</td>
                    <td className="px-2 py-2">
                      <span className="text-emerald-300">{row.stores_active}</span>
                      <span className="text-white/45"> / {row.stores_total}</span>
                    </td>
                    <td className="px-2 py-2 text-white/55">
                      {formatTime(row.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-white/55">No customer companies found.</div>
        )}
      </div>

      <div className="glass rounded-xl border p-4">
        <div className="mb-3 text-sm font-semibold">Recent Admin Accounts</div>
        {recentAdminAccounts.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-white/55">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Company</th>
                  <th className="px-2 py-2">Assigned Stores</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentAdminAccounts.map((user) => (
                  <tr key={user.id} className="border-b border-white/5">
                    <td className="px-2 py-2">{user.email}</td>
                    <td className="px-2 py-2">{user.company_name || "Unassigned"}</td>
                    <td className="px-2 py-2">{assignedStoreCount(user)}</td>
                    <td className="px-2 py-2">
                      {user?.is_active !== false ? (
                        <span className="text-emerald-300">Active</span>
                      ) : (
                        <span className="text-amber-300">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-white/55">
            No admin accounts available in this scope.
          </div>
        )}
      </div>
    </div>
  );
}
