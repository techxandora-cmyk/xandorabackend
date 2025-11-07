// rfid-dashboard/src/components/Metrics.jsx
import React from "react";

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 dark:bg-white/5 px-4 py-3 backdrop-blur">
      <div className="text-xs text-black/60 dark:text-white/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-black/50 dark:text-white/50">{hint}</div>
      ) : null}
    </div>
  );
}

export default function Metrics({ data, loading, error }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        Failed to load metrics. Check API & console.
      </div>
    );
  }

  const {
    total_sales_amount = 0,
    total_pos_transactions = 0,
    total_items_sold = 0,
    items_scanned_today = 0,
  } = data || {};

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat
        label="Total POS Sales"
        value={new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(total_sales_amount)}
        hint="Status: CONFIRMED"
      />
      <Stat
        label="POS Transactions"
        value={total_pos_transactions}
        hint="Status: CONFIRMED"
      />
      <Stat
        label="Items Sold"
        value={total_items_sold}
        hint="From POS items JSON"
      />
      <Stat
        label="Items Scanned (Today)"
        value={items_scanned_today}
        hint="From SCAN_BATCH events"
      />
    </div>
  );
}
