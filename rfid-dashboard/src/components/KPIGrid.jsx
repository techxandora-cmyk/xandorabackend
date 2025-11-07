// rfid-dashboard/src/components/KPIGrid.jsx
import React, { useEffect, useRef, useState } from "react";
import MetricCard from "./MetricCard";

export default function KPIGrid({ data, loading, apiBase, highlightKeys = [] }) {
  const [pulseKey, setPulseKey] = useState(null);
  const prev = useRef(data);

  useEffect(() => {
    if (!prev.current || !data) {
      prev.current = data;
      return;
    }
    // detect increase on any tracked key
    const grew = highlightKeys.some((k) => (data?.[k] ?? 0) > (prev.current?.[k] ?? 0));
    if (grew) {
      setPulseKey(Date.now());
      setTimeout(() => setPulseKey(null), 350);
    }
    prev.current = data;
  }, [data, highlightKeys]);

  const money = (n) =>
    new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(n ?? 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <MetricCard
        title="Total Sales (POS)"
        hint={`${data?.total_pos_transactions ?? 0} POS transactions`}
        value={money(data?.total_sales_amount)}
        loading={loading}
        pulse={!!pulseKey}
      />
      <MetricCard
        title="Items Sold (POS)"
        hint="sum of items in confirmed POS"
        value={data?.total_items_sold ?? 0}
        loading={loading}
        pulse={!!pulseKey}
      />
      <MetricCard
        title="Items Scanned Today"
        hint="handheld/reader batch scans"
        value={data?.items_scanned_today ?? 0}
        loading={loading}
        pulse={!!pulseKey}
      />
      <MetricCard
        title="Items Scanned (24h)"
        value={data?.items_scanned_24h ?? 0}
        loading={loading}
      />
      <MetricCard
        title="API Base"
        value={apiBase}
        mono
      />
      <MetricCard
        title="Last Updated"
        value={
          data?.last_updated
            ? new Date(data.last_updated).toLocaleString()
            : "—"
        }
      />
    </div>
  );
}
