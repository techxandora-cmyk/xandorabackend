import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/* =========================
   ROLES (CANONICAL)
========================= */
const ROLES = [
  { id: "ADMIN", label: "Admin" },
  { id: "STORE_MANAGER", label: "Store Manager" },
  { id: "STORE_STAFF", label: "Store Staff" },
  { id: "HANDHELD_USER", label: "Handheld User" },
];

/* =========================
   PERMISSION GROUPS
========================= */
const PERMISSION_GROUPS = {
  dashboard: {
    label: "Dashboard",
    perms: [
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
      "dashboard.view_audit_logs",
      "dashboard.manage_users",
      "dashboard.manage_roles",
    ],
  },
  handheld: {
    label: "Handheld",
    perms: [
      "handheld.scan_items",
      "handheld.inventory_count",
      "handheld.laundry_scan",
      "handheld.run_audits",
      "handheld.device_settings",
    ],
  },
  alerts: {
    label: "Alerts",
    perms: [
      "alerts.receive",
      "alerts.configure",
    ],
  },
};

export default function AdminRolePermissions() {
  const { isMasterAdmin, user } = useAuth();
  const [activeRole, setActiveRole] = useState("ADMIN");
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [companyName, setCompanyName] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setMsg("");

      const res = await apiGet("/admin/role-permissions");
      const permissionMap =
        res && typeof res === "object" && res.permissions
          ? res.permissions
          : res || {};

      setCompanyName(String(res?.company_name || user?.company_name || ""));
      setPermissions(permissionMap);
    } catch (e) {
      console.error(e);
      setError("Failed to load role permissions");
    } finally {
      setLoading(false);
    }
  }, [user?.company_name]);

  useEffect(() => {
    load();
  }, [load]);

  function togglePermission(role, perm) {
    setPermissions((prev) => {
      const set = new Set(prev[role] || []);
      set.has(perm) ? set.delete(perm) : set.add(perm);
      return { ...prev, [role]: Array.from(set) };
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setMsg("");

    try {
      await apiPut(
        `/admin/role-permissions/${encodeURIComponent(activeRole)}`,
        {
          permissions: permissions[activeRole] || [],
          ...(isMasterAdmin && companyName ? { company_name: companyName } : {}),
        }
      );
      setMsg("Permissions saved");
    } catch {
      setError("Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }

  const activePerms = new Set(permissions[activeRole] || []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded border text-sm">
            Refresh
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded bg-purple-600 text-white"
          >
            Save
          </button>
        </div>
      </div>

      <div className="text-xs opacity-70">
        Company scope: <span className="text-purple-300">{companyName || "N/A"}</span>
      </div>

      {error && <div className="bg-red-100 text-red-700 px-4 py-2 rounded">{error}</div>}
      {msg && <div className="bg-green-100 text-green-700 px-4 py-2 rounded">{msg}</div>}

      {/* ROLE TABS */}
      <div className="flex gap-2">
        {ROLES.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveRole(r.id)}
            className={`px-4 py-2 rounded ${
              activeRole === r.id
                ? "bg-purple-600 text-white"
                : "border"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* PERMISSIONS */}
      {loading ? (
        <div>Loading…</div>
      ) : (
        Object.entries(PERMISSION_GROUPS).map(([k, g]) => (
          <div key={k} className="glass p-4 rounded space-y-2">
            <h3 className="font-semibold">{g.label}</h3>
            {g.perms.map((p) => (
              <label key={p} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activePerms.has(p)}
                  onChange={() => togglePermission(activeRole, p)}
                />
                {p}
              </label>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
