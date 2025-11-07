// src/components/StoreMap3D.jsx
import React from "react";

/**
 * Lightweight faux-3D floor (isometric) with a few shelves + dots.
 * Size is clamped by CSS so it never overgrows.
 */
export default function StoreMap3D({ beacons = [] }) {
  const blips = (beacons.length ? beacons : [
    { x: 0.2, y: 0.55 },
    { x: 0.45, y: 0.48 },
    { x: 0.62, y: 0.58 },
  ]).slice(0, 5);

  return (
    <div className="glass rounded-xl border border-white/10 p-4">
      <div className="text-[10px] text-white/50 mb-2">Store Map 3D</div>

      <div className="map3d relative w-full overflow-hidden rounded-lg bg-black/20 dark:bg-white/[0.02]">
        {/* floor */}
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-[58%] h-[52%] w-[84%] -translate-x-1/2 -skew-x-[18deg] rounded-[18px] bg-[#1b1624] dark:bg-white/[0.03] shadow-[inset_0_-30px_80px_rgba(138,92,255,0.08)]" />
          {/* shelves */}
          <div className="absolute left-[18%] top-[42%] h-[8%] w-[22%] -skew-x-[18deg] rounded-md bg-white/5" />
          <div className="absolute left-[44%] top-[42%] h-[8%] w-[22%] -skew-x-[18deg] rounded-md bg-white/5" />
          <div className="absolute left-[70%] top-[42%] h-[8%] w-[22%] -skew-x-[18deg] rounded-md bg-white/5" />
        </div>

        {/* scanning beam (tight cone) */}
        <div className="absolute left-[22%] top-[50%] h-[22%] w-[22%] -skew-x-[18deg] origin-[20%_100%] animate-beam rotate-[12deg]">
          <div className="h-full w-full bg-[conic-gradient(from_0deg,theme(colors.violet.400/55),transparent_45%)] rounded-xl opacity-70" />
        </div>

        {/* dots */}
        {blips.map((b, i) => (
          <div
            key={i}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400 shadow-[0_0_14px_theme(colors.violet.400/70)]"
            style={{
              left: `${10 + b.x * 80}%`,
              top: `${40 + b.y * 35}%`,
              transform: "translate(-50%,-50%)",
            }}
          >
            <span className="absolute inset-0 rounded-full bg-violet-400/25 blur-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
