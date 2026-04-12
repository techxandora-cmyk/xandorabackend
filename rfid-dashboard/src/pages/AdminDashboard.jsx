import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function AdminDashboard() {
  const { isMasterAdmin } = useAuth();
  const [clearingOperationalLogs, setClearingOperationalLogs] = useState(false);
  const [operationalLogResult, setOperationalLogResult] = useState(null);
  const [error, setError] = useState("");
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [registryRows, setRegistryRows] = useState([]);
  const [registryCount, setRegistryCount] = useState(0);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("ALL");
  const [registryStoreId, setRegistryStoreId] = useState(
    localStorage.getItem("zyro_store_id") || "STORE_001"
  );
  const [registryQuery, setRegistryQuery] = useState("");
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState("");

  useEffect(() => {
    if (!isMasterAdmin) return;
    loadCompanies();
  }, [isMasterAdmin]);

  async function loadCompanies() {
    try {
      const res = await apiGet("/admin/users");
      const users = Array.isArray(res?.users) ? res.users : [];
      const names = Array.from(
        new Set(
          users
            .map((u) => String(u?.company_name || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      setCompanyOptions(names);
    } catch (e) {
      console.error("[admin/dashboard] failed to load company options", e);
    }
  }

  async function loadInternalTagRegistry() {
    setRegistryLoading(true);
    setRegistryError("");

    try {
      const params = new URLSearchParams();
      params.set("include_internal_uid", "true");
      params.set("limit", "200");

      const trimmedStore = String(registryStoreId || "").trim();
      const trimmedQuery = String(registryQuery || "").trim();
      const trimmedCompany =
        selectedCompany === "ALL" ? "" : String(selectedCompany || "").trim();

      if (trimmedStore) {
        params.set("store_id", trimmedStore);
      }

      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }

      if (trimmedCompany) {
        params.set("company_name", trimmedCompany);
      }

      const res = await apiGet(`/scans/tag-registry?${params.toString()}`);
      setRegistryRows(Array.isArray(res?.tags) ? res.tags : []);
      setRegistryCount(Number(res?.count || 0));
    } catch (e) {
      setRegistryRows([]);
      setRegistryCount(0);
      setRegistryError(e?.message || "Failed to load internal tag registry");
    } finally {
      setRegistryLoading(false);
    }
  }

  async function backfillFromExistingScans() {
    setBackfillMessage("");
    setRegistryError("");

    const companyName = String(selectedCompany || "").trim();
    if (!companyName || companyName === "ALL") {
      setRegistryError("Select a specific company before backfill.");
      return;
    }

    const storeId = String(registryStoreId || "").trim();

    setBackfillLoading(true);
    try {
      const res = await apiPost("/scans/tag-registry/backfill", {
        company_name: companyName,
        store_id: storeId || null,
        limit: 5000,
      });

      setBackfillMessage(
        `Backfill done: inserted ${res?.inserted ?? 0}, skipped ${res?.skipped_existing ?? 0}, candidates ${res?.scanned_candidates ?? 0}.`
      );

      await loadInternalTagRegistry();
    } catch (e) {
      setRegistryError(e?.message || "Backfill failed");
    } finally {
      setBackfillLoading(false);
    }
  }

  async function handleClearOperationalLogs() {
    const storeId = localStorage.getItem("zyro_store_id") || "STORE_001";
    const ok = window.confirm(
      `Clear all operational logs for ${storeId}? This removes scans, billing, inventory, and POS history for the selected store.`
    );
    if (!ok) return;

    setClearingOperationalLogs(true);
    setError("");
    setOperationalLogResult(null);

    try {
      const res = await apiPost("/admin/operations/clear-logs", {
        store_id: storeId,
      });

      setOperationalLogResult(res || null);

      window.dispatchEvent(new Event("zyro_store_changed"));
      window.dispatchEvent(new Event("zyro_scans_reset"));
      window.dispatchEvent(new Event("zyro_catalog_seeded"));
    } catch (e) {
      setError(e?.message || "Failed to clear operational logs");
    } finally {
      setClearingOperationalLogs(false);
    }
  }

  return (
    <div className="glass p-6 rounded-xl glow-border space-y-4">
      <h2 className="text-xl font-semibold text-purple-300">
        Admin Dashboard
      </h2>

      <p className="text-sm text-white/60">
        Select a section from the left to manage users, roles,
        alerts, and audit logs.
      </p>

      {/* Quick status hint (optional, safe) */}
      <div className="mt-4 text-xs text-white/40">
        System access: <span className="text-green-400">Active</span>
      </div>

      {isMasterAdmin ? (
        <>
          <div className="rounded-lg border border-white/10 p-4 space-y-3">
            <div className="text-sm font-semibold">Operational Controls</div>
            <p className="text-xs text-white/60">
              Use these controls carefully when you need to reset the selected store.
            </p>

            <button
              onClick={handleClearOperationalLogs}
              disabled={clearingOperationalLogs}
              className="px-4 py-2 rounded border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {clearingOperationalLogs
                ? "Clearing Operational Logs..."
                : "Clear Operational Logs (All Modules)"}
            </button>

            {error ? (
              <div className="text-xs text-red-400">{error}</div>
            ) : null}

            {operationalLogResult?.ok ? (
              <div className="text-xs text-green-400">
                Operational logs cleared for {operationalLogResult.store_id}.
                {" "}
                Scans: {operationalLogResult.deleted?.scan_items ?? 0} items /{" "}
                {operationalLogResult.deleted?.scan_batches ?? 0} batches.
                {" "}
                Billing: {operationalLogResult.deleted?.billing_session_scans ?? 0} scans /{" "}
                {operationalLogResult.deleted?.billing_sessions ?? 0} sessions.
                {" "}
                Inventory: {operationalLogResult.deleted?.inventory_scans ?? 0} scans /{" "}
                {operationalLogResult.deleted?.inventory_sessions ?? 0} sessions.
                {" "}
                POS: {operationalLogResult.deleted?.pos_transaction_items ?? 0} items /{" "}
                {operationalLogResult.deleted?.pos_transactions ?? 0} transactions.
                {" "}
                Catalog: {operationalLogResult.deleted?.catalog_items ?? 0} rows.
                {" "}
                Alerts: {operationalLogResult.deleted?.alerts ?? 0}.
                {" "}
                Live events: {operationalLogResult.deleted?.recent_events ?? 0}.
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3">
            <div className="text-sm font-semibold text-cyan-300">
              Internal Tag IDs (Master Only)
            </div>
            <p className="text-xs text-white/60">
              Hidden backend UIDs are visible here only for master access.
            </p>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="px-3 py-2 rounded bg-black/40 border border-white/20 text-xs"
              >
                <option value="ALL">All Companies</option>
                {companyOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <input
                value={registryStoreId}
                onChange={(e) => setRegistryStoreId(e.target.value)}
                className="px-3 py-2 rounded bg-black/40 border border-white/20 text-xs"
                placeholder="STORE_001 (optional)"
              />

              <input
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                className="px-3 py-2 rounded bg-black/40 border border-white/20 text-xs"
                placeholder="Search EPC/TID"
              />

              <button
                onClick={loadInternalTagRegistry}
                disabled={registryLoading}
                className="px-3 py-2 rounded border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-60 disabled:cursor-not-allowed text-xs"
              >
                {registryLoading ? "Loading..." : "Load Internal IDs"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={backfillFromExistingScans}
                disabled={backfillLoading}
                className="px-3 py-2 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 disabled:opacity-60 disabled:cursor-not-allowed text-xs"
              >
                {backfillLoading ? "Backfilling..." : "Import Existing Scans -> Internal IDs"}
              </button>
              {backfillMessage ? (
                <div className="text-xs text-green-400 self-center">{backfillMessage}</div>
              ) : null}
            </div>

            {registryError ? (
              <div className="text-xs text-red-400">{registryError}</div>
            ) : null}

            <div className="text-xs text-white/60">
              Results: {registryCount}
            </div>

            <div className="max-h-80 overflow-auto rounded border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-black/30">
                  <tr className="text-left">
                    <th className="px-2 py-2">Internal UID</th>
                    <th className="px-2 py-2">EPC</th>
                    <th className="px-2 py-2">TID</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Store</th>
                    <th className="px-2 py-2">Source</th>
                    <th className="px-2 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {registryRows.length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 opacity-60" colSpan={7}>
                        No internal tag rows loaded yet.
                      </td>
                    </tr>
                  ) : (
                    registryRows.map((row, index) => (
                      <tr key={`${row.internal_uid || "na"}-${index}`} className="border-t border-white/10">
                        <td className="px-2 py-2 font-mono text-[11px]">
                          {row.internal_uid || "-"}
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">{row.epc || "-"}</td>
                        <td className="px-2 py-2 font-mono text-[11px]">{row.tid || "-"}</td>
                        <td className="px-2 py-2">{row.company_name || "-"}</td>
                        <td className="px-2 py-2">{row.store_id || "-"}</td>
                        <td className="px-2 py-2">{row.source || "-"}</td>
                        <td className="px-2 py-2">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
