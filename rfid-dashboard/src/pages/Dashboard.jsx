// rfid-dashboard/src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { fetchMetrics, API_BASE } from "@/config/api";
import KPIGrid from "../components/KPIGrid";

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
      setM(data || {});
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
        <p className="subtle">Summary KPIs (clean dashboard)</p>
      </div>

      {err ? (
        <div className="rounded-md border border-red-300/50 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 px-4 py-3 mb-4">
          {err}
        </div>
      ) : null}

      {/* KPI Summary ONLY */}
      <KPIGrid
        data={m}
        loading={loading}
        apiBase={API_BASE}
        highlightKeys={[
          "total_pos_transactions",
          "total_items_sold",
          "items_scanned_today",
          "items_scanned_24h",
        ]}
      />
    </div>
  );
}
