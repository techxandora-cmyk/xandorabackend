import React from "react";

const items = [
  { href: "#/", label: "Overview", short: "OV" },
  { href: "#/devices", label: "Devices", short: "DV" },
  { href: "#/pos", label: "POS", short: "POS" },
  { href: "#/security", label: "Security", short: "SEC" },
];

export default function Sidebar({ dark }) {
  const hash = typeof location !== "undefined" ? location.hash || "#/" : "#/";

  return (
    <aside
      className={[
        "fixed left-0 top-14 bottom-0 z-30 group",
        "md:w-[92px] lg:w-[240px] w-[72px]",
        "transition-[width] duration-300 ease-out",
      ].join(" ")}
    >
      <div
        className={[
          "h-full backdrop-blur-xl",
          "border-r",
          dark
            ? "bg-[#0a0a0a]/55 border-white/10"
            : "bg-white/60 border-black/10",
        ].join(" ")}
      >
        <nav className="py-4">
          {items.map((item) => {
            const active =
              hash === item.href ||
              (item.href === "#/" && (hash === "" || hash === "#"));

            return (
              <a
                key={item.href}
                href={item.href}
                className={[
                  "flex items-center gap-3",
                  "mx-3 my-1.5 rounded-xl",
                  "px-3 py-2",
                  "transition-colors duration-200",
                  active
                    ? dark
                      ? "bg-white/10 text-white"
                      : "bg-white text-black shadow-sm"
                    : dark
                    ? "text-white/70 hover:bg-white/5"
                    : "text-black/70 hover:bg-black/5",
                ].join(" ")}
                title={item.label}
              >
                {/* Dot / badge */}
                <span
                  className={[
                    "inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-lg",
                    active
                      ? "bg-purple-500/90 text-white"
                      : dark
                      ? "bg-white/10 text-white/70"
                      : "bg-black/5 text-black/70",
                  ].join(" ")}
                >
                  {item.short}
                </span>

                {/* Label (hidden on narrow widths) */}
                <span className="hidden lg:inline text-sm">{item.label}</span>
              </a>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
