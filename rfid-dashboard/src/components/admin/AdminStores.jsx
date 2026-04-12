import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const STORE_ID_ALLOWED_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

function formatDate(ts) {
  if (!ts) return "-";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}

function normalizeStoreIdInput(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function AdminStores() {
  const { isMasterAdmin, user } = useAuth();
  const scopedCompany = String(user?.company_name || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [stores, setStores] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [showInactive, setShowInactive] = useState(false);

  const [companyName, setCompanyName] = useState(scopedCompany);
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const normalizedStoreIdPreview = normalizeStoreIdInput(storeId);
  const isStoreIdFormatValid = STORE_ID_ALLOWED_PATTERN.test(
    normalizedStoreIdPreview
  );

  const companyOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (stores || [])
          .map((s) => String(s?.company_name || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    if (scopedCompany && !names.includes(scopedCompany)) {
      names.unshift(scopedCompany);
    }

    return names;
  }, [stores, scopedCompany]);

  const loadStores = useCallback(async (options = {}) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      const effectiveShowInactive =
        typeof options.showInactive === "boolean"
          ? options.showInactive
          : showInactive;
      const effectiveCompanyFilter =
        typeof options.companyFilter === "string"
          ? options.companyFilter
          : companyFilter;

      if (effectiveShowInactive) {
        params.set("include_inactive", "1");
      }

      if (isMasterAdmin && effectiveCompanyFilter !== "ALL") {
        params.set("company_name", effectiveCompanyFilter);
      }

      const q = params.toString();
      const url = q ? `/admin/stores?${q}` : "/admin/stores";
      const res = await apiGet(url);
      setStores(Array.isArray(res?.stores) ? res.stores : []);
    } catch (e) {
      console.error(e);
      setStores([]);
      setError(e?.message || "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, [companyFilter, isMasterAdmin, showInactive]);

  useEffect(() => {
    if (!isMasterAdmin) {
      setCompanyName(scopedCompany);
    }
  }, [isMasterAdmin, scopedCompany]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  async function createStore() {
    setError("");
    setSuccess("");

    const payloadCompany = isMasterAdmin ? String(companyName || "").trim() : scopedCompany;
    const payloadStoreId = normalizeStoreIdInput(storeId);
    const payloadStoreName = String(storeName || "").trim();

    if (!payloadCompany) {
      setError("Company name is required");
      return;
    }

    if (!payloadStoreId) {
      setError("Store ID is required");
      return;
    }

    if (!STORE_ID_ALLOWED_PATTERN.test(payloadStoreId)) {
      setError(
        "Store ID must be 3-64 chars and use only A-Z, 0-9, underscore (_) or hyphen (-)."
      );
      return;
    }

    if (payloadStoreName && payloadStoreName.length > 80) {
      setError("Store Name must be 80 characters or less.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        company_name: payloadCompany,
        store_id: payloadStoreId,
        store_name: payloadStoreName || payloadStoreId,
      };

      const res = await apiPost("/admin/stores", payload);
      const createdStore = res?.store;

      setSuccess(
        `Saved store ${createdStore?.store_id || payloadStoreId} for ${createdStore?.company_name || payloadCompany}.`
      );
      setStoreId("");
      setStoreName("");

      if (isMasterAdmin && companyFilter === "ALL") {
        setCompanyName(payloadCompany);
      }

      await loadStores();
      localStorage.setItem("zyro_store_id", createdStore?.store_id || payloadStoreId);
      window.dispatchEvent(new Event("zyro_stores_updated"));
      window.dispatchEvent(new Event("zyro_store_changed"));
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to save store");
    } finally {
      setSaving(false);
    }
  }

  async function setStoreStatus(store, isActive) {
    setError("");
    setSuccess("");
    setTogglingId(`${store.company_name}::${store.store_id}`);

    try {
      await apiPost(`/admin/stores/${encodeURIComponent(store.store_id)}/status`, {
        company_name: store.company_name,
        is_active: isActive,
      });

      setSuccess(
        `${store.store_id} is now ${isActive ? "active" : "inactive"} for ${store.company_name}.`
      );
      if (!isActive) {
        setShowInactive(true);
        await loadStores({ showInactive: true });
      } else {
        await loadStores();
      }
      window.dispatchEvent(new Event("zyro_stores_updated"));
      window.dispatchEvent(new Event("zyro_store_changed"));
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to update store status");
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteStore(store) {
    const confirmDelete = window.confirm(
      `Delete store ${store.store_id} (${store.store_name || store.store_id})?\n\nThis removes the store from management and unmaps users from it.`
    );
    if (!confirmDelete) return;

    setError("");
    setSuccess("");

    const rowId = `${store.company_name}::${store.store_id}`;
    setDeletingId(rowId);

    try {
      const query = isMasterAdmin
        ? `?company_name=${encodeURIComponent(store.company_name)}`
        : "";
      const res = await apiDelete(
        `/admin/stores/${encodeURIComponent(store.store_id)}${query}`
      );
      const removedRoles = Number(res?.deleted?.removed_user_store_roles || 0);

      if ((localStorage.getItem("zyro_store_id") || "") === store.store_id) {
        localStorage.removeItem("zyro_store_id");
      }

      setSuccess(
        `Deleted ${store.store_id} from ${store.company_name}. Removed ${removedRoles} user-store mappings.`
      );
      await loadStores();
      window.dispatchEvent(new Event("zyro_stores_updated"));
      window.dispatchEvent(new Event("zyro_store_changed"));
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to delete store");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass p-6 rounded-xl">
        <h2 className="text-lg font-semibold mb-3">Store Management</h2>
        <p className="text-xs opacity-70 mb-4">
          Create customer stores with custom IDs and names. You can add as many stores as needed.
        </p>

        {error ? <div className="mb-3 text-sm text-red-400">{error}</div> : null}
        {success ? <div className="mb-3 text-sm text-green-400">{success}</div> : null}

        <div className="grid md:grid-cols-4 gap-2">
          <input
            className="px-3 py-2 rounded bg-black/40 border border-white/20"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company Name"
            disabled={!isMasterAdmin}
          />
          <input
            className="px-3 py-2 rounded bg-black/40 border border-white/20"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            onBlur={() => setStoreId(normalizeStoreIdInput(storeId))}
            placeholder="Store ID (required) e.g. COLOMBO_001"
          />
          <input
            className="px-3 py-2 rounded bg-black/40 border border-white/20"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Store Name (optional) e.g. Colombo Flagship"
          />
          <button
            onClick={createStore}
            disabled={saving}
            className="px-4 py-2 rounded border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Store"}
          </button>
        </div>

        <div className="mt-3 text-[11px] opacity-70">
          Store ID format: `A-Z`, `0-9`, `_`, `-` only, 3-64 chars.
          Example: `COLOMBO_001`, `KANDY-CENTRAL_02`.
        </div>
        <div
          className={`mt-1 text-[11px] ${
            normalizedStoreIdPreview
              ? isStoreIdFormatValid
                ? "text-emerald-300"
                : "text-amber-300"
              : "opacity-60"
          }`}
        >
          Normalized ID preview: {normalizedStoreIdPreview || "-"}
          {normalizedStoreIdPreview && !isStoreIdFormatValid
            ? " (needs valid length/format)"
            : ""}
        </div>
        <div className="mt-1 text-[11px] opacity-60">
          Store Name is the display label (any readable text, max 80 chars).
        </div>

        <div className="mt-2 text-[11px] opacity-60">
          Note: if your store picker does not refresh immediately, log out and log in once.
        </div>
      </div>

      <div className="glass p-6 rounded-xl">
        <div className="flex flex-wrap gap-3 justify-between items-end mb-4">
          <div>
            <h3 className="text-base font-semibold">Stores</h3>
            <div className="text-xs opacity-70">
              {loading ? "Loading stores..." : `${stores.length} store(s) found`}
            </div>
          </div>

          <div className="flex gap-2 items-center">
            {isMasterAdmin ? (
              <select
                className="px-3 py-2 rounded bg-black/40 border border-white/20 text-xs min-w-40"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
              >
                <option value="ALL">All companies</option>
                {companyOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : null}

            <label className="text-xs opacity-80 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
          </div>
        </div>

        {loading ? (
          <div className="text-sm opacity-70">Loading...</div>
        ) : stores.length === 0 ? (
          <div className="text-sm opacity-70">No stores found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-white/60">
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 pr-3">Company</th>
                  <th className="text-left py-2 pr-3">Store ID</th>
                  <th className="text-left py-2 pr-3">Store Name</th>
                  <th className="text-left py-2 pr-3">Users</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-left py-2 pr-3">Updated</th>
                  <th className="text-left py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const rowId = `${store.company_name}::${store.store_id}`;
                  const busy = togglingId === rowId || deletingId === rowId;

                  return (
                    <tr key={rowId} className="border-b border-white/5">
                      <td className="py-2 pr-3">{store.company_name}</td>
                      <td className="py-2 pr-3 font-semibold">{store.store_id}</td>
                      <td className="py-2 pr-3">{store.store_name}</td>
                      <td className="py-2 pr-3">{Number(store.user_count || 0)}</td>
                      <td className="py-2 pr-3">
                        {store.is_active ? (
                          <span className="text-emerald-300">Active</span>
                        ) : (
                          <span className="text-rose-300">Inactive</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs opacity-70">
                        {formatDate(store.updated_at)}
                      </td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setStoreStatus(store, !store.is_active)}
                            disabled={busy}
                            className="px-2 py-1 rounded border border-white/20 hover:bg-white/10 disabled:opacity-60 text-xs"
                          >
                            {togglingId === rowId
                              ? "Saving..."
                              : store.is_active
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                          <button
                            onClick={() => deleteStore(store)}
                            disabled={busy}
                            className="px-2 py-1 rounded border border-rose-500/45 text-rose-300 hover:bg-rose-500/10 disabled:opacity-60 text-xs"
                          >
                            {deletingId === rowId ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
