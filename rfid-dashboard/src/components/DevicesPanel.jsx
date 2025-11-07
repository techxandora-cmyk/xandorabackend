// src/components/DevicesPanel.jsx
import React, { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";

export default function DevicesPanel() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      setErr("");
      const r = await fetch(`${API_BASE}/api/v1/devices`);
      if (!r.ok) throw new Error(`API error ${r.status}`);
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message || "failed");
      setRows([]);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass rounded-xl p-5 border border-white/10 bg-white/5 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-white/60">Connected Devices</div>
        <button
          className="text-[11px] px-2 py-1 border border-white/10 rounded-md hover:bg-white/10"
          onClick={load}
          aria-label="Refresh devices"
        >
          Refresh
        </button>
      </div>

      {err ? (
        <div className="text-red-300 text-sm mb-2">Error: {err}</div>
      ) : null}

      {rows.length === 0 ? (
        <div className="text-white/50 text-sm">No devices yet</div>
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between text-sm border border-white/10 rounded-md px-3 py-2 bg-white/5 dark:bg-white/[0.04]"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    d.active ? "bg-emerald-400" : "bg-zinc-500"
                  }`}
                  title={d.active ? "Active" : "Inactive"}
                />
                <div>
                  <div className="text-white/90">{d.name || d.id}</div>
                  <div className="text-white/40 text-xs">
                    {d.id} · {d.store_id || "—"}
                  </div>
                </div>
              </div>
              <div className="text-white/40 text-xs">
                {d.last_seen ? new Date(d.last_seen).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
