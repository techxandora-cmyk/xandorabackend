// src/components/UI/TopBar.jsx
import { Moon, SunMedium } from "lucide-react";
import { motion as Motion } from "framer-motion";

export default function TopBar({ title, onToggleTheme, isDark }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur-xl bg-white/60 dark:bg-zinc-900/60 border-b border-black/5 dark:border-white/5">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm sm:text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          {title}
        </Motion.h1>

        <button
          onClick={onToggleTheme}
          className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium
          border border-black/10 dark:border-white/10
          bg-white/70 dark:bg-zinc-800/70 hover:bg-white/90 dark:hover:bg-zinc-800/90
          shadow-sm"
        >
          {isDark ? <SunMedium size={16} /> : <Moon size={16} />}
          <span>{isDark ? "Light" : "Dark"}</span>
        </button>
      </div>
    </div>
  );
}
