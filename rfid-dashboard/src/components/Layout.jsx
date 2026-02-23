import React from "react";

export default function Layout({ state, onToggleDark, children }) {
  const { dark } = state ?? {};

  return (
    <div
      data-dark={dark ? "true" : "false"}
      className={`min-h-screen transition-colors duration-300 ${
        dark ? "bg-[#0a0a0a] text-white" : "bg-[#f5f5f7] text-black"
      }`}
    >
      {/* Inline styles: glow, pulse, flicker fixes, light-mode visibility fixes */}
      <style>{`
        /* Global smoothing & stable GPU layers to reduce flicker */
        *, *::before, *::after {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          -webkit-transform: translateZ(0);
          transform: translateZ(0);
          backface-visibility: hidden;
        }

        /* Gentle transitions for color/background/box-shadow only */
        header, main, .glass, .card, .kpi-card, .stat-card, .panel {
          will-change: background-color, color, box-shadow, transform;
          transition: background-color .26s ease, color .22s ease, box-shadow .28s ease, transform .18s ease;
        }

        /* per-card glow container rules (apply class "glass" or "card" to your card wrappers) */
        .glass, .card, .kpi-card, .stat-card, .panel, .dashboard-card {
          position: relative;
          z-index: 0;
          border-radius: 12px;
          overflow: visible;
        }

        .glass::after,
        .card::after,
        .kpi-card::after,
        .stat-card::after,
        .panel::after,
        .dashboard-card::after {
          content: "";
          position: absolute;
          inset: -26px;              /* ensures glow spreads outside the block */
          border-radius: inherit;
          z-index: -1;
          pointer-events: none;
          filter: blur(36px);
          transition: opacity .35s ease, transform .35s ease;
          opacity: 1;
          mix-blend-mode: normal;
          transform-origin: center;
        }

        /* subtle pulsing animation (very gentle) */
        @keyframes glowPulse {
          0%   { transform: scale(1); opacity: 0.95; }
          50%  { transform: scale(1.02); opacity: 1; }
          100% { transform: scale(1); opacity: 0.95; }
        }

        /* Dark mode: stronger, deeper purple halo */
        [data-dark="true"] .glass::after,
        [data-dark="true"] .card::after,
        [data-dark="true"] .kpi-card::after,
        [data-dark="true"] .stat-card::after,
        [data-dark="true"] .panel::after,
        [data-dark="true"] .dashboard-card::after {
          background: radial-gradient(35% 40% at 30% 20%,
            rgba(167,139,250,0.46) 0%,
            rgba(124,67,201,0.26) 28%,
            rgba(0,0,0,0) 70%);
          box-shadow:
            0 0 48px rgba(124,67,201,0.36),
            0 0 20px rgba(167,139,250,0.22);
          animation: glowPulse 6s ease-in-out infinite;
        }

        /* Light mode: softer but still visible glow so cards keep that purple accent */
        [data-dark="false"] .glass::after,
        [data-dark="false"] .card::after,
        [data-dark="false"] .kpi-card::after,
        [data-dark="false"] .stat-card::after,
        [data-dark="false"] .panel::after,
        [data-dark="false"] .dashboard-card::after {
          background: radial-gradient(45% 45% at 50% 25%,
            rgba(167,139,250,0.28) 0%,
            rgba(167,139,250,0.12) 32%,
            rgba(255,255,255,0) 70%);
          box-shadow:
            0 0 34px rgba(167,139,250,0.18),
            0 0 14px rgba(167,139,250,0.10);
          filter: blur(30px);
          animation: glowPulse 6.4s ease-in-out infinite;
        }

        /* Slight lift on hover to imply depth (non-intrusive) */
        .glass:hover, .card:hover, .panel:hover {
          transform: translateY(-2px);
        }

        /* Light-mode visibility fixes for heartbeat & active badges (ensures contrast) */
        [data-dark="false"] .heartbeat,
        [data-dark="false"] .btn-heart,
        [data-dark="false"] .btn,
        [data-dark="false"] .btn-ghost {
          color: #0f1720 !important; /* dark text for buttons in light mode */
          border-color: rgba(167,139,250,0.22) !important;
          background: rgba(167,139,250,0.07) !important;
          box-shadow: 0 6px 18px rgba(167,139,250,0.06);
        }

        [data-dark="false"] .status-pill,
        [data-dark="false"] .badge-success,
        [data-dark="false"] .active-pill {
          background: #e6fff0 !important;
          color: #06402a !important;
          border: 1px solid rgba(16,185,129,0.14) !important;
          box-shadow: 0 4px 12px rgba(16,185,129,0.06);
        }

        /* Prevent flicker on theme switch by keeping same backdrop-blur and only changing overlay colors */
        header {
          -webkit-backdrop-filter: blur(10px);
          backdrop-filter: blur(10px);
          transition: background-color .28s ease, border-color .28s ease;
        }

        /* Keep focus outlines tidy and visible on both themes */
        button:focus, a:focus {
          outline: 2px solid rgba(167,139,250,0.14);
          outline-offset: 2px;
        }

        /* Minor accessibility/color fixes for nav and toggles */
        .nav-pill { transition: background-color .18s, color .18s, border-color .18s; }
      `}</style>

      {/* Apple-style top bar (unchanged layout; only dark/light toggle on right) */}
      <header
        className={[
          "sticky top-0 z-40 backdrop-blur-xl",
          dark
            ? "bg-[#0a0a0a]/60 border-b border-white/10"
            : "bg-white/60 border-b border-black/10"
        ].join(" ")}
      >
        <div className="mx-auto max-w-[1200px] px-4">
          <div className="h-14 flex items-center justify-between">
            {/* Left title */}
            <div className="flex items-center gap-2 select-none">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background:
                    "radial-gradient(12px 12px at 40% 40%, #c9bcff 0 35%, #a98aff 35% 60%, #7e57ff 60% 100%)",
                  boxShadow: "0 0 12px 3px rgba(167,139,250,0.6)"
                }}
              />
              <span
                className={`text-sm font-medium tracking-tight ${
                  dark ? "text-white/80" : "text-black/80"
                }`}
              >
                RFID Dashboard
              </span>
            </div>

            {/* Mid navigation */}
            <nav className="hidden md:flex items-center gap-1 select-none">
              {[
                { href: "#/", label: "Overview" },
                { href: "#/devices", label: "Devices" },
                { href: "#/pos", label: "POS" },
                { href: "#/security", label: "Security" }
              ].map(({ href, label }) => {
                const active =
                  location.hash === href ||
                  (href === "#/" &&
                    (location.hash === "" || location.hash === "#"));
                return (
                  <a
                    key={href}
                    href={href}
                    className={`nav-pill px-3 py-1.5 rounded-full text-sm transition ${
                      active
                        ? dark
                          ? "bg-white/10 border border-white/10 text-white"
                          : "bg-white/80 text-black border border-black/10"
                        : dark
                        ? "text-white/60 hover:bg-white/10"
                        : "text-black/60 hover:bg-black/5"
                    }`}
                  >
                    {label}
                  </a>
                );
              })}
            </nav>

            {/* Right — Only Dark/Light toggle (unchanged) */}
            <button
              onClick={onToggleDark}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all select-none ${
                dark
                  ? "border-white/20 text-white hover:bg-white/10"
                  : "border-black/20 text-black hover:bg-black/10"
              }`}
              aria-label="Toggle theme"
            >
              {dark ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>

      {/* Main content container (unchanged spacing) */}
      <main className="mx-auto max-w-[1200px] px-4 py-6">{children}</main>
    </div>
  );
}
