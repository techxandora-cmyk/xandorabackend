// rfid-dashboard/src/components/LiveFeed.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/api";

// tiny synth click (no file needed)
function useClick() {
  const ctxRef = useRef(null);
  return () => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ctxRef.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 660;
      g.gain.value = 0.0001;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      o.stop(ctx.currentTime + 0.09);
    // eslint-disable-next-line no-unused-vars
    } catch (_err) { /* empty */ }
  };
}

export default function LiveFeed() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("connecting");
  const click = useClick();

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/v1/events/stream`, { withCredentials: false });

    es.addEventListener("hello", () => setStatus("live"));
    es.addEventListener("scan", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setRows((r) => {
          const next = [data, ...r].slice(0, 40);
          return next;
        });
        click();
      // eslint-disable-next-line no-unused-vars
      } catch (_err) { /* empty */ }
    });
    es.onerror = () => setStatus("reconnecting");

    return () => es.close();
  }, [click]);

  const badge = useMemo(() => {
    if (status === "live") return <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">LIVE</span>;
    if (status === "reconnecting") return <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-400/30">reconnecting…</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/20 text-sky-200 border border-sky-400/30">connecting…</span>;
  }, [status]);

  return (
    <div className="rounded-xl p-5 border border-white/10 bg-white/5 dark:bg-white/[0.03] shadow-[0_0_50px_-20px] shadow-violet-500/30">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-white/60">Live Scanner Feed</div>
          <div className="text-[11px] text-white/40">soft click + neon pulse</div>
        </div>
        <div>{badge}</div>
      </div>

      <div className="relative">
        <div className="absolute inset-0 rounded-lg pointer-events-none [background:radial-gradient(120px_60px_at_0%_0%,rgba(168,85,247,.12),transparent_60%),radial-gradient(160px_80px_at_100%_0%,rgba(99,102,241,.10),transparent_60%)]"></div>
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-black/10 dark:bg-white/[0.02]">
              <tr className="[&>th]:py-2 [&>th]:px-3 text-white/60 text-xs">
                <th>Time</th>
                <th>Tag</th>
                <th>Device</th>
                <th>Location</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-white/40 text-sm">Waiting for scans…</td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id}
                    className="animate-[fadeIn_.35s_ease-out] border-t border-white/5 hover:bg-white/5">
                  <td className="py-2 px-3 text-white/70">{new Date(r.t).toLocaleTimeString()}</td>
                  <td className="py-2 px-3 font-mono text-white">{r.tag}</td>
                  <td className="py-2 px-3 text-white/80">{r.device_id}</td>
                  <td className="py-2 px-3 text-white/80">{r.location}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] border ${
                      r.type === 'exit'
                        ? 'bg-rose-500/15 text-rose-300 border-rose-400/30'
                        : 'bg-violet-500/15 text-violet-200 border-violet-400/30'
                    }`}>{r.type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* subtle bottom glow */}
      <div className="mt-3 h-1 w-full rounded-full bg-gradient-to-r from-violet-500/40 via-fuchsia-500/40 to-indigo-500/40 blur-[2px]" />
    </div>
  );
}
