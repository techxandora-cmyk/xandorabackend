// src/components/Devices.jsx
import React, { useEffect, useState } from "react";
import { fetchDevices, heartbeatDevice } from "../lib/api";

function Badge({ ok, children }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-md text-[10px] font-medium border
        ${ok
          ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"
          : "bg-rose-500/10 text-rose-300 border-rose-400/30"}
      `}
    >
      {children}
    </span>
  );
}

function formatAgo(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function DevicesPanel() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      const list = await fetchDevices();
      // Safe sort: newest updated first
      const sorted = [...list].sort((a, b) => {
        const ta = new Date(a.updated_at || 0).getTime();
        const tb = new Date(b.updated_at || 0).getTime();
        return tb - ta;
      });
      setRows(sorted);
      setErr("");
    } catch (e) {
      setErr(e.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  async function ping(id) {
    try {
      await heartbeatDevice(id);
      await load();
    } catch (e) {
      setErr(`Heartbeat failed: ${e.message}`);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-black dark:text-white">
          Connected Devices
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="px-3 h-9 rounded-md text-xs font-medium border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/70 dark:text-white/80"
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-200 px-4 py-2 mb-3">
          Error: {err}
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-black/10 dark:border-white/10 glass glow-border">
        <table className="min-w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/50">
            <tr className="bg-black/5 dark:bg-white/5">
              <th className="text-left px-4 py-2">ID</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Store</th>
              <th className="text-left px-4 py-2">Active</th>
              <th className="text-left px-4 py-2">Last Seen</th>
              <th className="text-left px-4 py-2">Updated</th>
              <th className="text-left px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/10">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-black/60 dark:text-white/60">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-black/60 dark:text-white/60">
                  No devices yet
                </td>
              </tr>
            ) : (
              rows.map((d) => {
                const isActive = !!d.active;
                return (
                  <tr key={d.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="px-4 py-2 font-medium text-black dark:text-white">{d.id}</td>
                    <td className="px-4 py-2 text-black/80 dark:text-white/80">{d.name || "—"}</td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">{d.store_id || "—"}</td>
                    <td className="px-4 py-2">
                      <Badge ok={isActive}>{isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">
                      {d.last_seen ? `${formatAgo(d.last_seen)} (${new Date(d.last_seen).toLocaleString()})` : "—"}
                    </td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">
                      {d.updated_at ? new Date(d.updated_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => ping(d.id)}
                        className="px-2.5 h-8 rounded-md text-[11px] font-medium border border-violet-400/40 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20"
                      >
                        Heartbeat
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
