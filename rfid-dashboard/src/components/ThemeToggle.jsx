import React from "react";

export default function ThemeToggle() {
  function toggleMode() {
    document.documentElement.classList.toggle("dark");
  }

  return (
    <button
      onClick={toggleMode}
      className="px-3 py-1 text-xs rounded-md border border-zinc-700 dark:border-zinc-300 text-zinc-300 dark:text-zinc-200 hover:bg-zinc-800 dark:hover:bg-zinc-200 hover:text-white dark:hover:text-black transition"
    >
      Toggle Theme
    </button>
  );
}
