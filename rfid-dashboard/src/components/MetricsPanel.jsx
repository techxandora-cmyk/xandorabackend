// src/components/MetricsPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

function moneyLKR(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function KPI({ label, value, sub }) {
  return (
    <div className="glass rounded-lg p-3 border">
      <div className="text-xs text-black/60 dark:text-white/50">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub ? (
        <div className="text-[11px] text-black/50 dark:text-white/40 mt-1">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export default function MetricsPanel() {
  const [data, setData] = useState(null);
  const [storeId, setStoreId] = useState(() => {
    return localStorage.getItem("zyro_store_id") || "STORE_001";
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load(activeStore) {
    const sid = activeStore || storeId;

    setLoading(true);
    setErr("");

    try {
      const r = await apiGet(
        `/metrics/summary?store_id=${encodeURIComponent(sid)}`
      );
      setData(r || null);
    } catch (e) {
      console.error("[MetricsPanel] load failed:", e);
      setErr(e?.message || "Failed to load metrics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // initial load
  useEffect(() => {
    load(storeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload when store changes (dropdown in Layout)
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

  // ✅ FIX ESLINT: do ALL object access inside useMemo
  const computed = useMemo(() => {
    const metrics = data?.metrics || {};
    const pos = metrics?.pos || {};
    const scansToday = metrics?.scans_today || {};
    const scans24h = metrics?.scans_last_24h || {};

    return {
      totalSalesAmount: Number(pos?.total_sales_amount || 0),
      totalItemsSold: Number(pos?.total_items_sold || 0),
      totalPosTxns: Number(pos?.total_pos_txns || 0),

      scannedToday: Number(scansToday?.scanned_today || 0),
      scanned24h: Number(scans24h?.scanned_last_24h || 0),

      generatedAt: metrics?.generated_at || new Date().toISOString(),
    };
  }, [data]);

  return (
    <div className="glass rounded-xl p-5 border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Overview</div>
          <div className="text-xs text-black/60 dark:text-white/50">
            Summary KPIs only • Store: <strong>{storeId}</strong>
          </div>
        </div>

        <button
          onClick={() => load(storeId)}
          className="px-3 py-2 rounded border border-black/10 dark:border-white/10 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          {err}
        </div>
      ) : null}

      {!data ? (
        <div className="text-sm text-black/60 dark:text-white/50">
          {loading ? "Loading metrics…" : "No metrics available."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <KPI
              label="Total Sales (POS)"
              value={moneyLKR(computed.totalSalesAmount)}
              sub={`POS transactions: ${computed.totalPosTxns}`}
            />
            <KPI
              label="Items Sold (POS)"
              value={computed.totalItemsSold}
              sub="POS total items"
            />
            <KPI
              label="Items Scanned Today"
              value={computed.scannedToday}
              sub="RFID scans"
            />
            <KPI
              label="Items Scanned (24h)"
              value={computed.scanned24h}
              sub="Rolling 24 hours"
            />
          </div>

          <div className="mt-3 text-xs text-black/50 dark:text-white/40">
            Last updated:{" "}
            <span className="opacity-90">{fmtTime(computed.generatedAt)}</span>
          </div>
        </>
      )}
    </div>
  );
}
