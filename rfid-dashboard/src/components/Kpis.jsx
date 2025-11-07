// rfid-dashboard/src/components/Kpis.jsx
import React from "react";

function Card({ title, hint, children }) {
  return (
    <div
      className="glass rounded-lg p-5 border border-muted bg-panel text-main"
      style={{
        background:
          "linear-gradient(180deg, rgba(139,92,246,0.06) 0%, rgba(0,0,0,0) 100%)",
      }}
    >
      <div className="text-xs font-medium text-soft">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{children}</div>
      {hint ? <div className="mt-1 text-[11px] text-soft">{hint}</div> : null}
    </div>
  );
}

export default function Kpis({ data, apiBase, updatedAt, Radar }) {
  const {
    total_sales_amount = 0,
    total_pos_transactions = 0,
    total_items_sold = 0,
    items_scanned_today = 0,
    items_scanned_24h = 0,
  } = data || {};

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      <Card
        title="Total Sales (POS)"
        hint={`${total_pos_transactions} POS transactions`}
      >
        LKR {total_sales_amount.toFixed(2)}
      </Card>

      <Card title="Items Sold (POS)" hint="sum of items in confirmed POS">
        {total_items_sold}
      </Card>

      <Card title="Items Scanned Today" hint="handheld/reader batch scans">
        {items_scanned_today}
      </Card>

      <Card title="Items Scanned (24h)">{items_scanned_24h}</Card>

      <Card title="API Base">
        <code className="font-mono">{apiBase}</code>
      </Card>

      <Card title="Last Updated">{updatedAt ? updatedAt : "—"}</Card>

      {/* Radar HUD */}
      {Radar ? (
        <div className="xl:col-span-3">
          <div className="glass rounded-lg p-5 border border-muted bg-panel">
            <div className="text-xs text-soft mb-2 flex items-center justify-between">
              <span>Scanner HUD</span>
              <span>radar + pulse</span>
            </div>
            <Radar />
          </div>
        </div>
      ) : null}
    </div>
  );
}
