// src/pages/Home.jsx

function Card({ title, value, hint }) {
  return (
    <div
      className="rounded-xl p-4 bg-white/70 dark:bg-zinc-900/70 border border-black/5 dark:border-white/5 backdrop-blur-xl
                 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]"
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="Live Readers" value="4" hint="2 handheld · 2 gates" />
        <Card title="Tags Today" value="1,284" hint="+12% vs yesterday" />
        <Card title="POS Sales" value="Rs 148,920" hint="3 refunds" />
        <Card title="Security Alerts" value="0" hint="All clear" />
      </div>

      <div className="rounded-2xl p-6 bg-gradient-to-tr from-violet-600/15 via-fuchsia-500/10 to-sky-500/15 border border-violet-400/20 dark:border-violet-300/15">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Welcome to <span className="text-violet-600 dark:text-violet-300">AuroraRFID</span>
        </div>
        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Hybrid dashboard + POS + handheld flow. This is a themed shell — wire your real data next.
        </div>
      </div>
    </div>
  );
}
