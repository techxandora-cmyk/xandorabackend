// rfid-dashboard/src/components/MetricCard.jsx
import React from "react";

export default function MetricCard({ title, hint, value, loading, mono, pulse }) {
  return (
    <div className={`glass-neon rounded-2xl p-5 ${pulse ? "animate-bump" : ""}`}>
      <div className="text-xs text-zinc-400 mb-2">{title}</div>
      <div className={`text-2xl font-semibold ${mono ? "font-mono" : ""}`}>
        {loading ? <span className="animate-pulse text-zinc-500">…</span> : value}
      </div>
      {hint && <div className="text-[11px] text-zinc-500 mt-2">{hint}</div>}
    </div>
  );
}
