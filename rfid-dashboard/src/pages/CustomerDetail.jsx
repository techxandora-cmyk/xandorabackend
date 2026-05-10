import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";

function formatDate(ts) {
  if (!ts) return "-";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}

export default function CustomerDetail() {
  const navigate = useNavigate();
  const [company, setCompany] = useState(
    () => localStorage.getItem("xandora_company_view") || ""
  );
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingStores, setLoadingStores] = useState(false);
  const [error, setError] = useState("");

  // readers + handheld devices per store: keyed by store_id
  const [expandedStore, setExpandedStore] = useState(null);
  const [storeReaders, setStoreReaders] = useState({});
  const [storeDevices, setStoreDevices] = useState({});
  const [loadingReaders, setLoadingReaders] = useState(null);
  const [readerError, setReaderError] = useState({});

  // Load all company names for the dropdown
  useEffect(() => {
    apiGet("/admin/stores")
      .then((res) => {
        const all = Array.isArray(res?.stores) ? res.stores : [];
        const names = Array.from(
          new Set(
            all
              .map((s) => String(s?.company_name || "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        setCompanies(names);
        // auto-select first if nothing is selected yet
        if (!localStorage.getItem("xandora_company_view") && names.length) {
          selectCompany(names[0]);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectCompany(name) {
    if (name) {
      localStorage.setItem("xandora_company_view", name);
    } else {
      localStorage.removeItem("xandora_company_view");
    }
    window.dispatchEvent(new Event("xandora_company_view_changed"));
    setCompany(name);
    // reset expanded readers when switching company
    setExpandedStore(null);
    setStoreReaders({});
    setStoreDevices({});
    setReaderError({});
  }

  const loadUsers = useCallback(async (companyName) => {
    if (!companyName) return;
    setLoadingUsers(true);
    try {
      const res = await apiGet("/admin/users");
      const all = Array.isArray(res?.users) ? res.users : [];
      setUsers(
        all.filter(
          (u) =>
            String(u?.company_name || "").trim().toLowerCase() ===
            companyName.trim().toLowerCase()
        )
      );
    } catch (e) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadStores = useCallback(async (companyName) => {
    if (!companyName) return;
    setLoadingStores(true);
    try {
      const res = await apiGet(
        `/admin/stores?company_name=${encodeURIComponent(companyName)}&include_inactive=1`
      );
      setStores(Array.isArray(res?.stores) ? res.stores : []);
    } catch (e) {
      setError(e?.message || "Failed to load stores");
    } finally {
      setLoadingStores(false);
    }
  }, []);

  useEffect(() => {
    if (!company) return;
    loadUsers(company);
    loadStores(company);
  }, [company, loadUsers, loadStores]);

  async function toggleReaders(store) {
    const key = store.store_id;
    if (expandedStore === key) {
      setExpandedStore(null);
      return;
    }
    setExpandedStore(key);
    if (storeReaders[key]) return;
    setLoadingReaders(key);
    setReaderError((p) => ({ ...p, [key]: "" }));
    try {
      const [readersRes, devicesRes] = await Promise.allSettled([
        apiGet(`/admin/readers?company_name=${encodeURIComponent(store.company_name)}&store_id=${encodeURIComponent(store.store_id)}`),
        apiGet(`/devices?store_id=${encodeURIComponent(store.store_id)}`),
      ]);
      setStoreReaders((p) => ({
        ...p,
        [key]: readersRes.status === "fulfilled" ? (readersRes.value.readers || []) : [],
      }));
      if (readersRes.status === "rejected") {
        setReaderError((p) => ({ ...p, [key]: readersRes.reason?.message || "Failed to load readers" }));
      }
      setStoreDevices((p) => ({
        ...p,
        [key]: devicesRes.status === "fulfilled" ? (devicesRes.value.devices || []) : [],
      }));
    } finally {
      setLoadingReaders(null);
    }
  }

  async function toggleReader(storeKey, reader) {
    try {
      await apiPatch(`/admin/readers/${reader.id}`, { is_active: !reader.is_active });
      setStoreReaders((p) => ({
        ...p,
        [storeKey]: (p[storeKey] || []).map((r) =>
          r.id === reader.id ? { ...r, is_active: !r.is_active } : r
        ),
      }));
    } catch (e) {
      alert(e?.message || "Failed to update reader");
    }
  }

  async function deleteReader(storeKey, readerId) {
    if (!confirm("Remove this reader?")) return;
    try {
      await apiDelete(`/admin/readers/${readerId}`);
      setStoreReaders((p) => ({
        ...p,
        [storeKey]: (p[storeKey] || []).filter((r) => r.id !== readerId),
      }));
    } catch (e) {
      alert(e?.message || "Failed to delete reader");
    }
  }

  const activeUsers = users.filter((u) => u.is_active !== false);
  const adminUsers = users.filter((u) =>
    (Array.isArray(u.roles) ? u.roles : []).some(
      (r) => String(r?.role || "").toUpperCase() === "ADMIN"
    )
  );
  const activeStores = stores.filter((s) => s.is_active);

  return (
    <div className="space-y-6">
      {/* Header with company dropdown */}
      <div className="glass p-5 rounded-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-xs text-white/50 mb-1">Customer</p>
            <select
              value={company}
              onChange={(e) => selectCompany(e.target.value)}
              className="rounded border border-white/20 bg-black/40 px-3 py-1.5 text-sm font-semibold focus:outline-none min-w-48"
            >
              <option value="">— Select customer —</option>
              {companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {company && (
            <p className="text-xs text-white/40 mt-4">Customer admin panel</p>
          )}
        </div>
      </div>

      {!company && (
        <div className="glass p-6 rounded-xl text-white/50 text-sm">
          Select a customer above to view their users, stores, and readers.
        </div>
      )}

      {company && (
      <>
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Users", value: users.length },
          { label: "Active Users", value: activeUsers.length },
          { label: "Admin Accounts", value: adminUsers.length },
          { label: "Active Stores", value: activeStores.length },
        ].map((s) => (
          <div key={s.label} className="glass rounded-xl border p-4">
            <div className="text-[11px] text-white/50">{s.label}</div>
            <div className="text-2xl font-semibold mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Users */}
      <div className="glass p-5 rounded-xl">
        <h3 className="font-semibold mb-3">
          Users{" "}
          <span className="text-xs text-white/40 font-normal ml-1">
            ({users.length})
          </span>
        </h3>
        {loadingUsers ? (
          <div className="text-xs text-white/40">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="text-xs text-white/40">No users found for this company.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/40 border-b border-white/10">
                  <th className="text-left py-2 pr-4">Email</th>
                  <th className="text-left py-2 pr-4">Role</th>
                  <th className="text-left py-2 pr-4">Store</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const roles = Array.isArray(u.roles) ? u.roles : [];
                  const primary = roles[0];
                  return (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 pr-4 font-mono text-xs">{u.email}</td>
                      <td className="py-2 pr-4 text-xs text-white/70">
                        {primary?.role || "-"}
                      </td>
                      <td className="py-2 pr-4 text-xs text-white/50">
                        {primary?.store_id || "—"}
                      </td>
                      <td className="py-2 text-xs">
                        <span
                          className={
                            u.is_active !== false
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          {u.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stores + Readers */}
      <div className="glass p-5 rounded-xl">
        <h3 className="font-semibold mb-3">
          Stores{" "}
          <span className="text-xs text-white/40 font-normal ml-1">
            ({stores.length})
          </span>
        </h3>
        {loadingStores ? (
          <div className="text-xs text-white/40">Loading stores…</div>
        ) : stores.length === 0 ? (
          <div className="text-xs text-white/40">No stores found for this company.</div>
        ) : (
          <div className="space-y-3">
            {stores.map((store) => {
              const key = store.store_id;
              const isExpanded = expandedStore === key;
              const readers = storeReaders[key] || [];
              const devices = storeDevices[key] || [];
              const rErr = readerError[key] || "";

              return (
                <div
                  key={key}
                  className="rounded-lg border border-white/10 overflow-hidden"
                >
                  {/* Store row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-white/5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          store.is_active ? "bg-green-400" : "bg-red-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {store.store_name || store.store_id}
                        </div>
                        <div className="text-[11px] text-white/40">
                          ID: {store.store_id} · Updated: {formatDate(store.updated_at)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleReaders(store)}
                      className={`px-3 py-1 text-xs rounded border flex items-center gap-1 transition-colors ${
                        isExpanded
                          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                          : "border-white/20 hover:bg-white/10"
                      }`}
                    >
                      {loadingReaders === key ? (
                        "Loading…"
                      ) : (
                        <>
                          Devices
                          {storeReaders[key] !== undefined && (
                            <span className="opacity-60">
                              ({readers.length + devices.length})
                            </span>
                          )}
                          <span className="opacity-50">{isExpanded ? "▲" : "▼"}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Devices panel */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 bg-black/20 space-y-4">
                      {/* RFID Readers */}
                      <div>
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">
                          RFID Readers
                        </p>
                        {rErr ? (
                          <div className="text-xs text-red-400">{rErr}</div>
                        ) : readers.length === 0 ? (
                          <div className="text-xs text-white/30 py-1">No readers registered.</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-white/40 border-b border-white/10">
                                <th className="text-left py-1.5 pr-3">IP</th>
                                <th className="text-left py-1.5 pr-3">Zone</th>
                                <th className="text-left py-1.5 pr-3">Device ID</th>
                                <th className="text-left py-1.5 pr-3">Status</th>
                                <th className="text-left py-1.5">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {readers.map((r) => (
                                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="py-1.5 pr-3 font-mono">{r.reader_ip}</td>
                                  <td className="py-1.5 pr-3 text-white/60">{r.zone_id || "-"}</td>
                                  <td className="py-1.5 pr-3 text-white/60">{r.device_id || "-"}</td>
                                  <td className="py-1.5 pr-3">
                                    <span className={r.is_active ? "text-green-400" : "text-red-400"}>
                                      {r.is_active ? "Active" : "Inactive"}
                                    </span>
                                  </td>
                                  <td className="py-1.5 flex gap-2">
                                    <button
                                      onClick={() => toggleReader(key, r)}
                                      className="px-2 py-0.5 rounded border border-white/20 hover:bg-white/10"
                                    >
                                      {r.is_active ? "Disable" : "Enable"}
                                    </button>
                                    <button
                                      onClick={() => deleteReader(key, r.id)}
                                      className="px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* Handheld Devices */}
                      <div>
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">
                          Handheld Devices
                        </p>
                        {devices.length === 0 ? (
                          <div className="text-xs text-white/30 py-1">No handheld devices registered.</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-white/40 border-b border-white/10">
                                <th className="text-left py-1.5 pr-3">Device ID</th>
                                <th className="text-left py-1.5 pr-3">Model</th>
                                <th className="text-left py-1.5 pr-3">Zone</th>
                                <th className="text-left py-1.5 pr-3">Last Seen</th>
                                <th className="text-left py-1.5">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {devices.map((d) => (
                                <tr key={d.device_id} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="py-1.5 pr-3 font-mono text-white/80">{d.device_id}</td>
                                  <td className="py-1.5 pr-3 text-white/60">{d.model || "-"}</td>
                                  <td className="py-1.5 pr-3 text-white/60">{d.zone_id || "-"}</td>
                                  <td className="py-1.5 pr-3 text-white/40">
                                    {d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : "Never"}
                                  </td>
                                  <td className="py-1.5">
                                    <span className={d.is_online ? "text-green-400" : "text-white/40"}>
                                      {d.is_online ? "Online" : "Offline"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
