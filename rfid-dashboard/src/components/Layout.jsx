// rfid-dashboard/src/components/Layout.jsx
import React, { useEffect, useState } from "react";

const TABS = [
  { key: "overview", label: "Overview", href: "#overview", icon: "📊" },
  { key: "devices",  label: "Devices",  href: "#devices",  icon: "🖧" },
  { key: "pos",      label: "POS",      href: "#pos",      icon: "🧾" },
  { key: "security", label: "Security", href: "#security", icon: "🔒" },
];

export default function Layout({ children, onToggleDark, state }) {
  const dark = !!state?.dark;
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const pick = () => {
      const h = (window.location.hash || "#overview").replace("#", "");
      setActive(h || "overview");
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header / top bar with brand + pills + theme toggle */}
      <header className="sticky top-0 z-30 border-b"
              style={{
                borderColor: "var(--stroke)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                background: "color-mix(in oklab, var(--panel) 86%, transparent)"
              }}>
        <div className="mx-auto max-w-6xl px-3 lg:px-4 py-2 flex items-center gap-3">
          {/* Brand dot + name */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block rounded-full"
              style={{
                width: 14, height: 14,
                background:
                  "radial-gradient(14px 14px at 40% 40%, #c9bcff 0 35%, #a98aff 35% 60%, #7e57ff 60% 100%)",
                boxShadow:
                  "0 0 10px #a98aff, 0 0 24px rgba(169,138,255,.6), 0 0 42px rgba(169,138,255,.35)",
              }}
            />
            <span className="font-medium tracking-wide" style={{color:"var(--ink)"}}>
              RFID Dashboard
            </span>
          </div>

          {/* Pills */}
          <nav className="ml-4 flex-1 overflow-x-auto no-scrollbar">
            <ul className="flex items-center gap-2 min-w-max">
              {TABS.map(t => {
                const isActive = active === t.key;
                return (
                  <li key={t.key}>
                    <a
                      href={t.href}
                      className={[
                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-sm border",
                        "transition-all",
                        isActive
                          ? "border-transparent"
                          : ""
                      ].join(" ")}
                      style={{
                        color: "var(--ink)",
                        borderColor: "var(--stroke)",
                        background: isActive
                          ? "color-mix(in oklab, var(--panel) 70%, var(--acc-0) 14%)"
                          : "color-mix(in oklab, var(--panel) 85%, var(--ink) 3%)",
                        boxShadow: isActive
                          ? "0 0 0 4px rgba(126,87,255,.18)"
                          : "none"
                      }}
                      title={t.label}
                    >
                      <span aria-hidden>{t.icon}</span>
                      <span>{t.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Theme toggle only (glow is permanent now) */}
          <button
            type="button"
            onClick={onToggleDark}
            className="btn btn-ghost"
            aria-label={dark ? "Switch to Light" : "Switch to Dark"}
            title={dark ? "Switch to Light" : "Switch to Dark"}
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-3 lg:px-4 py-4">
          {children}
        </div>
      </main>
    </div>
  );
}
