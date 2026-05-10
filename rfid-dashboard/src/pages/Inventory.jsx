import React, { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPost } from "@/lib/api";

export default function Inventory() {
  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
  );

  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryItemsSource, setInventoryItemsSource] = useState("active_session");
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const progressTimerRef = useRef(null);

  /* =========================
     LOAD INVENTORY
  ========================= */
  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [historyRes, activeRes, kpisRes, itemsRes] = await Promise.all([
        apiGet(`/inventory/history?store_id=${storeId}`),
        apiGet(`/inventory/active?store_id=${storeId}`),
        apiGet(`/inventory/kpis?store_id=${storeId}`),
        apiGet(`/inventory/items?store_id=${storeId}&limit=200`),
      ]);

      setSessions(historyRes?.sessions || []);
      setActiveSession(activeRes?.session || null);
      setKpis(kpisRes?.kpis || null);
      setInventoryItems(Array.isArray(itemsRes?.items) ? itemsRes.items : []);
      setInventoryItemsSource(String(itemsRes?.source || "active_session"));
    } catch (err) {
      console.error("[Inventory]", err);
      if (err?.status === 401) {
        setError("Session expired. Please login again.");
      } else {
        setError(err?.error || "Failed to load inventory");
      }
      setInventoryItems([]);
      setInventoryItemsSource("active_session");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("xandora_store_id") || "STORE_001";
      setStoreId(sid);
    }

    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
  }, []);

  /* =========================
     LIVE PROGRESS POLLING
  ========================= */
  const loadProgress = useCallback(async () => {
    try {
      const [res, itemsRes] = await Promise.all([
        apiGet(`/inventory/progress?store_id=${storeId}`),
        apiGet(`/inventory/items?store_id=${storeId}&limit=200`),
      ]);

      if (!res?.active) return;
      setInventoryItems(Array.isArray(itemsRes?.items) ? itemsRes.items : []);
      setInventoryItemsSource(String(itemsRes?.source || "active_session"));

      setActiveSession((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          total_found: res.found || 0,
          total_expected: res.expected || 0,
          accuracy_percent: res.accuracy || 0,
        };
      });
    } catch (err) {
      if (err?.status === 401) {
        setError("Session expired. Please login again.");
        stopProgressPolling();
      }
    }
  }, [storeId]);

  function startProgressPolling() {
    stopProgressPolling();
    progressTimerRef.current = setInterval(loadProgress, 2000);
  }

  function stopProgressPolling() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (activeSession?.status === "ACTIVE") {
      startProgressPolling();
    } else {
      stopProgressPolling();
    }

    return stopProgressPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  /* =========================
     ACTIONS
  ========================= */
  async function startSession() {
    try {
      setActionLoading(true);
      setError("");

      await apiPost("/inventory/start", {
        store_id: storeId,
        total_expected: 0,
      });

      await loadInventory();
    } catch (err) {
      setError(err?.error || "Failed to start session");
    } finally {
      setActionLoading(false);
    }
  }

  async function endSession() {
    try {
      setActionLoading(true);
      setError("");

      await apiPost("/inventory/end", { store_id: storeId });

      stopProgressPolling();
      await loadInventory();
    } catch (err) {
      setError(err?.error || "Failed to end session");
    } finally {
      setActionLoading(false);
    }
  }

  const found = activeSession?.total_found || 0;
  const expected = activeSession?.total_expected || 0;
  const accuracy =
    expected > 0
      ? Math.round((found / expected) * 100)
      : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm opacity-60">Store: {storeId}</p>
      </div>

      {/* ERROR */}
      {error && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <div className="text-xs opacity-60">Sessions</div>
            <div className="mt-2 text-3xl font-semibold">
              {kpis.sessions_total}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <div className="text-xs opacity-60">Avg Accuracy</div>
            <div className="mt-2 text-3xl font-semibold">
              {Number(kpis.avg_accuracy_percent).toFixed(1)}%
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-5">
            <div className="text-xs opacity-60">Unique EPCs</div>
            <div className="mt-2 text-3xl font-semibold">
              {kpis.unique_epcs_total}
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE SESSION */}
      <div className="rounded-xl border border-white/10 mb-6 bg-black/40">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">
          Active Session
        </div>

        <div className="px-4 py-4 text-sm">
          {activeSession ? (
            <div className="space-y-4">
              <div className="text-green-400 font-semibold">
                LIVE Inventory Session
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="rounded-lg bg-black/50 p-3">
                  <div className="text-xs opacity-60">Found</div>
                  <div className="text-xl font-semibold">{found}</div>
                </div>
                <div className="rounded-lg bg-black/50 p-3">
                  <div className="text-xs opacity-60">Expected</div>
                  <div className="text-xl font-semibold">{expected}</div>
                </div>
                <div className="rounded-lg bg-black/50 p-3">
                  <div className="text-xs opacity-60">Accuracy</div>
                  <div className="text-xl font-semibold">{accuracy}%</div>
                </div>
              </div>

              <div className="w-full h-2 rounded bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all"
                  style={{ width: `${accuracy}%` }}
                />
              </div>

              <button
                onClick={endSession}
                disabled={actionLoading}
                className="rounded bg-red-600/80 px-4 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
              >
                End Session
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="opacity-60">No active session</div>
                <div className="text-xs opacity-50">
                  Bridge feed is live; start a session for a controlled cycle count.
                </div>
              </div>
              <button
                onClick={startSession}
                disabled={actionLoading}
                className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-500 disabled:opacity-50"
              >
                Start Inventory Session
              </button>
            </div>
          )}
        </div>
      </div>

      {/* HISTORY */}
      <div className="rounded-xl border border-white/10 bg-black/40 mb-6">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">
          {inventoryItemsSource === "active_session"
            ? "Active Session Items"
            : "Recent Scanned Items (24h)"}
        </div>

        {inventoryItems.length === 0 ? (
          <div className="px-4 py-4 text-sm opacity-60">
            No mapped EPC items yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-black/60">
                <tr>
                  <th className="px-4 py-3 text-left">EPC</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Brand</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-left">Price</th>
                  <th className="px-4 py-3 text-left">Reads</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item) => (
                  <tr key={item.epc} className="border-t border-white/5">
                    <td className="px-4 py-3 font-mono">{item.epc}</td>
                    <td className="px-4 py-3">{item.product_name || "Unmapped item"}</td>
                    <td className="px-4 py-3">{item.brand || "—"}</td>
                    <td className="px-4 py-3">{item.category || "—"}</td>
                    <td className="px-4 py-3">{item.size_label || "—"}</td>
                    <td className="px-4 py-3">
                      {`LKR ${Number(item.price_lkr || 0).toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3">{item.read_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/40">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">
          Inventory Timeline
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm opacity-50">Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-black/60">
              <tr>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Ended</th>
                <th className="px-4 py-3 text-left">Accuracy</th>
                <th className="px-4 py-3 text-left">Found</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    {new Date(s.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {s.ended_at
                      ? new Date(s.ended_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {Number(s.accuracy_percent).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    {s.found_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
