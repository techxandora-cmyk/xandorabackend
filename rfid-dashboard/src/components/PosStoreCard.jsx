// src/components/PosStoreCard.jsx
import React, { useState } from "react";

export default function PosStoreCard({ store }) {
  const [flipped, setFlipped] = useState(false);

  // Choose 240px width card as you requested (Option A)
  // Card uses absolute front/back so flipping won't change layout/height.
  return (
    <div
      className="flex-none w-[240px] h-[220px] relative cursor-pointer select-none"
      onClick={() => setFlipped((v) => !v)}
      aria-pressed={flipped}
      role="button"
    >
      <div
        className="absolute inset-0 transition-transform duration-500"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          willChange: "transform",
        }}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 glass rounded-xl p-4 border border-black/10 dark:border-white/10
                     bg-white/60 dark:bg-white/[0.03] flex flex-col justify-between"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "translateZ(0)",
          }}
        >
          <div>
            <div className="text-sm font-semibold text-black dark:text-white">
              {store.name || store.store_id}
            </div>

            <div className="mt-2 text-xl font-bold text-black dark:text-white">
              {store.sales ?? (store.today_amount ? `LKR ${store.today_amount}` : "LKR 0")}
            </div>

            <div className="text-[12px] mt-1 text-black/60 dark:text-white/60">
              {store.items ?? `${store.today_items ?? 0} items sold`}
            </div>
          </div>

          <div className="text-[11px] opacity-60 text-right text-black/60 dark:text-white/60">
            Tap to flip ↻
          </div>
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 glass rounded-xl p-4 border border-black/10 dark:border-white/10
                     bg-white/60 dark:bg-white/[0.03] flex flex-col justify-between"
          style={{
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
          // allow clicking back face specifically (won't bubble to parent flip twice)
          onClick={(e) => {
            e.stopPropagation();
            setFlipped(false);
          }}
        >
          <div>
            <div className="text-sm font-semibold text-black dark:text-white">
              POS Details
            </div>

            <div className="mt-3 space-y-1 text-[13px] text-black/70 dark:text-white/70">
              <div>
                Today:{" "}
                {store.pos?.today_amount ?? store.today_amount
                  ? store.pos?.today_amount ?? `LKR ${store.today_amount}`
                  : "—"}
              </div>
              <div>
                Transactions: {store.pos?.txns ?? store.txns ?? "—"}
              </div>
              <div>
                Items sold: {store.pos?.items ?? store.items ?? "—"}
              </div>
            </div>
          </div>

          <div className="text-[11px] opacity-60 text-right text-black/60 dark:text-white/60">
            Tap to flip back ↺
          </div>
        </div>
      </div>

      {/* Local utility styles — keep small to avoid global CSS changes */}
      <style>{`
        /* ensure 3d and flipping helper classes are effective here */
        .glass { /* keep your existing glass styles — this is just a safety fallback */ }
      `}</style>
    </div>
  );
}
