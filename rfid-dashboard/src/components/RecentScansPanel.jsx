// src/components/RecentScansPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export default function RecentScansPanel() {
  // store from Layout dropdown (localStorage)
  const [store_id, setStoreId] = useState(() => {
    return localStorage.getItem("zyro_store_id") || "STORE_001";
  });

  const [limit, setLimit] = useState(50);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);

  // prevent stale polling when switching stores
  const storeRef = useRef(store_id);
  useEffect(() => {
    storeRef.current = store_id;
  }, [store_id]);

  async function load(activeStoreId) {
    const sid = activeStoreId || storeRef.current || store_id;

    setErr("");
    setLoading(true);

    try {
      const r = await apiGet(
        `/scans?store_id=${encodeURIComponent(sid)}&limit=${encodeURIComponent(
          limit
        )}`
      );

      // ✅ backend returns scans[]
      const scans = Array.isArray(r?.scans) ? r.scans : [];

      setRows(scans);
      setCount(Number(r?.count || scans.length || 0));
    } catch (e) {
      console.error("[RecentScansPanel] load failed:", e);
      setErr(e?.message || "Failed to load scans");
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }

  // initial load + polling
  useEffect(() => {
    load(store_id);

    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        load(storeRef.current);
      }
    }, 2000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // listen to store dropdown changes
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

  const stats = useMemo(() => {
    const r = Array.isArray(rows) ? rows : [];
    const uniqueTags = new Set(r.map((x) => x?.tag).filter(Boolean)).size;

    const lastSeen =
      r.length > 0 ? r[0]?.ts || r[0]?.created_at || r[0]?.last_seen : null;

    return { uniqueTags, lastSeen };
  }, [rows]);

  return (
    <div className="glass rounded-xl p-5 border">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold">Recent Scans</div>
          <div className="text-xs text-black/60 dark:text-white/50">
            Live RFID scan feed (store filtered)
          </div>
        </div>

        <button
          onClick={() => load(store_id)}
          className="px-3 py-1 rounded border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="text-xs text-black/60 dark:text-white/50 mb-4">
        Store: <strong>{store_id}</strong> • Showing last{" "}
        <strong>{limit}</strong> • API count: <strong>{count}</strong> • Unique
        Tags Loaded: <strong>{stats.uniqueTags}</strong> • Last Seen:{" "}
        <strong>{fmtTime(stats.lastSeen)}</strong>
      </div>

      {err ? (
        <div className="rounded-md border border-red-300/50 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 px-4 py-3 mb-4">
          {err}
        </div>
      ) : null}

      {/* Controls */}
      <div className="glass rounded-xl p-4 border mb-4 flex items-center gap-3 flex-wrap">
        <div className="text-xs text-black/60 dark:text-white/50">Limit</div>
        <select
          value={limit}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLimit(v);
            // refresh immediately when changing limit
            setTimeout(() => load(storeRef.current), 0);
          }}
          className="px-3 py-2 rounded border border-black/10 dark:border-white/10 bg-transparent text-sm"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>

        <div className="ml-auto text-xs text-black/60 dark:text-white/50">
          Auto refresh: 2s
        </div>
      </div>

      {/* Table */}
      <div className="glass rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 text-sm font-semibold">
          Scan Events
        </div>

        {loading && rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-black/50 dark:text-white/40">
            Loading scans…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-black/50 dark:text-white/40">
            No scans found
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Tag</th>
                  <th className="px-4 py-3 text-left font-medium">Device</th>
                  <th className="px-4 py-3 text-left font-medium">Store</th>
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((s, idx) => (
                  <tr
                    key={`${s?.id || s?.tag || "scan"}-${idx}`}
                    className="border-t border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <td className="px-4 py-3 font-medium">
                      {s?.tag || <span className="opacity-50">—</span>}
                    </td>

                    <td className="px-4 py-3 text-black/70 dark:text-white/60">
                      {s?.device_id || "—"}
                    </td>

                    <td className="px-4 py-3 text-black/70 dark:text-white/60">
                      {s?.store_id || "—"}
                    </td>

                    <td className="px-4 py-3 text-black/70 dark:text-white/60">
                      {fmtTime(s?.ts || s?.created_at || s?.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-black/50 dark:text-white/40">
        Note: This is reading from <code>/api/v1/scans</code> and expects{" "}
        <code>{`{ scans: [] }`}</code>.
      </div>
    </div>
  );
}
