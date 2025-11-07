// rfid-dashboard/src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { fetchMetrics } from "../lib/api";

function Stat({ label, value, sub, glow }) {
  return (
    <div className={`card ${glow ? "glow" : ""} p-4`}>
      <div className="text-sm text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? (
        <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [m, setM] = useState({
    total_sales_amount: 0,
    total_pos_transactions: 0,
    total_items_sold: 0,
    items_scanned_today: 0,
    items_scanned_24h: 0,
    last_updated: null,
  });

  async function load() {
    try {
      setErr("");
      const data = await fetchMetrics();
      setM(data);
    } catch (e) {
      setErr(e?.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="h1">Overview</h1>
        <p className="subtle">Live KPIs from middleware API</p>
      </div>

      {err ? (
        <div className="rounded-md border border-red-300/50 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 px-4 py-3 mb-4">
          {err}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Stat
          glow
          label="Total Sales (POS)"
          value={`LKR ${Number(m.total_sales_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`${m.total_pos_transactions || 0} POS transactions`}
        />
        <Stat
          glow
          label="Items Sold (POS)"
          value={m.total_items_sold || 0}
          sub="sum of items in confirmed POS"
        />
        <Stat
          glow
          label="Items Scanned Today"
          value={m.items_scanned_today || 0}
          sub="handheld/reader batch scans"
        />
        <Stat label="Items Scanned (24h)" value={m.items_scanned_24h || 0} />
        <Stat
          label="API Base"
          value={import.meta.env.VITE_API_BASE || "http://localhost:3000"}
        />
        <Stat
          label="Last Updated"
          value={
            m.last_updated
              ? new Date(m.last_updated).toLocaleString()
              : loading
              ? "Loading…"
              : "—"
          }
        />
      </div>
    </div>
  );
}
