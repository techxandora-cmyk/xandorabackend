// src/components/InventoryPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

function formatAgo(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function InventoryPanel() {
  // ✅ ACTIVE STORE comes from Layout dropdown (localStorage)
  const [store_id, setStoreId] = useState(() => {
    return localStorage.getItem("zyro_store_id") || "STORE_001";
  });

  const [active, setActive] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Live heartbeat
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  async function load(activeStoreId) {
    const sid = activeStoreId || store_id;

    setErr("");
    setLoading(true);

    try {
      const a = await apiGet(`/inventory/active?store_id=${sid}`);
      const k = await apiGet(`/inventory/kpis?store_id=${sid}`);
      const h = await apiGet(`/inventory/history?store_id=${sid}&limit=10`);

      setActive(a?.session || null);
      setKpis(k?.kpis || null);
      setHistory(Array.isArray(h?.sessions) ? h.sessions : []);

      setLastUpdatedAt(Date.now());
    } catch (e) {
      console.error("[InventoryPanel] load failed:", e);
      setErr("Failed to load inventory data");
      setActive(null);
      setKpis(null);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  // initial load
  useEffect(() => {
    load(store_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ listen to store dropdown changes (Layout)
  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("zyro_store_id") || "STORE_001";
      setStoreId(sid);
      load(sid);
    }

    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () =>
      window.removeEventListener("zyro_store_changed", onStoreChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto refresh (live)
  useEffect(() => {
    if (!autoRefresh) return;

    const id = setInterval(() => {
      load(store_id);
    }, 8000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, store_id]);

  // heartbeat timer to update "Updated Xs ago"
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const updatedAgo = useMemo(() => {
    return formatAgo(nowTick - (lastUpdatedAt || 0));
  }, [nowTick, lastUpdatedAt]);

  return (
    <div className="glass rounded-xl p-5 border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="text-[11px]">Inventory</div>

          {/* Live Heartbeat */}
          <div className="flex items-center gap-2 text-[11px] text-black/50 dark:text-white/40">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"
              }`}
            />
            <span>{autoRefresh ? "Live" : "Paused"}</span>
            <span>•</span>
            <span>Store: {store_id}</span>
            <span>•</span>
            <span>Updated {lastUpdatedAt ? updatedAgo : "—"}</span>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className="ml-2 px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
              title="Toggle live refresh"
            >
              {autoRefresh ? "Pause" : "Resume"}
            </button>
          </div>
        </div>

        <button
          onClick={() => load(store_id)}
          className="px-3 py-1 rounded border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="text-sm mb-4">
        <div>
          <span className="text-black/60 dark:text-white/50">Store:</span>{" "}
          <strong>{store_id}</strong>
        </div>

        <div className="mt-2">
          <span className="text-black/60 dark:text-white/50">
            Active Session:
          </span>{" "}
          <strong>{active ? `#${active.id}` : "None"}</strong>
        </div>

        {err && <div className="mt-2 text-sm text-red-500">{err}</div>}
      </div>

      {/* KPI CARDS */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="glass rounded-lg p-3 border">
            <div className="text-[11px] text-black/60 dark:text-white/50">
              Sessions Total
            </div>
            <div className="text-lg font-semibold">{kpis.sessions_total}</div>
          </div>

          <div className="glass rounded-lg p-3 border">
            <div className="text-[11px] text-black/60 dark:text-white/50">
              Sessions Ended
            </div>
            <div className="text-lg font-semibold">{kpis.sessions_ended}</div>
          </div>

          <div className="glass rounded-lg p-3 border">
            <div className="text-[11px] text-black/60 dark:text-white/50">
              Unique EPCs Total
            </div>
            <div className="text-lg font-semibold">
              {kpis.unique_epcs_total ?? 0}
            </div>
          </div>
        </div>
      )}

      {/* HISTORY */}
      <div className="text-sm">
        <div className="text-black/60 dark:text-white/50 mb-2">
          Recent Sessions
        </div>

        {history.length === 0 ? (
          <div className="text-black/50 dark:text-white/40 text-sm">
            No history found
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((s) => (
              <div
                key={s.id}
                className="glass rounded-lg p-3 border flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">
                    Session #{s.id} • {s.status}
                  </div>
                  <div className="text-xs text-black/60 dark:text-white/50">
                    Found: {s.found_count || 0}
                  </div>
                </div>

                <div className="text-xs text-black/60 dark:text-white/50">
                  {s.started_at ? new Date(s.started_at).toLocaleString() : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
