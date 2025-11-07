import React from "react";

export default function Topbar({ onToggleDark, onToggleGlow, health, api }) {
  return (
    <div className="w-full border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/10 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-5 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="h-7 w-7 rounded-md flex items-center justify-center"
            style={{
              background:
                "radial-gradient(120% 120% at 50% 10%, rgba(168,85,247,0.8), rgba(99,102,241,0.5))",
              boxShadow:
                "0 0 12px rgba(168,85,247,0.45), 0 0 22px rgba(99,102,241,0.35)",
            }}
          >
            <span className="text-xs font-bold text-white">RF</span>
          </div>
          <div className="title headline-glow leading-none">
            RetailFlow <span className="opacity-60 text-sm align-middle">beta</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-sm opacity-70">
            API: <span className="opacity-100">{api.replace(/^https?:\/\//, "")}</span>
          </span>
          <span
            className={`text-xs px-2 py-1 rounded-md ${
              health === "OK"
                ? "bg-green-500/15 text-green-500 border border-green-500/30"
                : "bg-red-500/15 text-red-400 border border-red-500/30"
            }`}
          >
            {health}
          </span>
          <button className="badge" onClick={onToggleGlow}>Glow</button>
          <button className="btn-primary" onClick={onToggleDark}>Theme</button>
        </div>
      </div>
    </div>
  );
}
