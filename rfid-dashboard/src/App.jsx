// src/App.jsx
import React, { useEffect, useState } from "react";
import Layout from "./components/Layout";
import { initTheme, toggleDark, toggleGlow } from "./lib/theme";
import { API_BASE, fetchMetrics } from "./lib/api";
import DevicesPanel from "./components/Devices";

function Card({ title, children, subtitle }) {
  return (
    <div className="glass rounded-xl p-5 border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.03]">
      <div className="text-black/60 dark:text-white/70 text-[11px] mb-2">{title}</div>
      {children}
      {subtitle && (
        <div className="text-[11px] text-black/50 dark:text-white/40 mt-2">
          {subtitle}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [ui, setUi] = useState({ dark: true, glow: true });
  const [metrics, setMetrics] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setUi(initTheme());

    const load = async () => {
      try {
        const m = await fetchMetrics();
        setMetrics(m);
        setErr("");
      } catch (e) {
        setErr(`Failed to fetch: ${e.message}`);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const handleDark = () => {
    const nextDark = toggleDark();
    setUi((u) => ({ ...u, dark: nextDark }));
  };

  const handleGlow = () => {
    const nextGlow = toggleGlow();
    setUi((u) => ({ ...u, glow: nextGlow }));
  };

  const fmt = (n) => (n == null ? "—" : n.toLocaleString());
  const money = (n) => `LKR ${Number(n || 0).toFixed(2)}`;

  return (
    <Layout onToggleDark={handleDark} onToggleGlow={handleGlow} state={ui}>
      <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">
        Overview
      </h2>
      <div className="text-sm text-black/60 dark:text-white/50 mb-5">
        Live KPIs from middleware API
      </div>

      {err && (
        <div className="rounded-md border border-red-600/30 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200 px-4 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card
          title="Total Sales (POS)"
          subtitle={`${fmt(metrics?.total_pos_transactions)} POS transactions`}
        >
          <div className="text-3xl font-semibold text-black dark:text-white">
            {money(metrics?.total_sales_amount)}
          </div>
        </Card>

        <Card title="Items Sold (POS)" subtitle="sum of items in confirmed POS">
          <div className="text-3xl font-semibold text-black dark:text-white">
            {fmt(metrics?.total_items_sold)}
          </div>
        </Card>

        <Card title="Items Scanned Today" subtitle="handheld/reader batch scans">
          <div className="text-3xl font-semibold text-black dark:text-white">
            {fmt(metrics?.items_scanned_today)}
          </div>
        </Card>

        <Card title="Items Scanned (24h)">
          <div className="text-3xl font-semibold text-black dark:text-white">
            {fmt(metrics?.items_scanned_24h)}
          </div>
        </Card>

        <Card title="API Base">
          <div className="text-2xl font-[800] tracking-tight text-black dark:text-white">
            {API_BASE}
          </div>
        </Card>

        <Card title="Last Updated">
          <div className="text-3xl font-semibold text-black dark:text-white">
            {metrics?.last_updated
              ? new Date(metrics.last_updated).toLocaleString()
              : "—"}
          </div>
        </Card>
      </div>

      {/* Devices */}
      <DevicesPanel />
    </Layout>
  );
}
