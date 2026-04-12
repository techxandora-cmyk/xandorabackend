// src/lib/theme.js

const KEY = "zyro_theme";

export function initTheme() {
  const saved = localStorage.getItem(KEY);
  const dark = saved ? saved === "dark" : true;

  const root = document.documentElement;

  if (dark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  return { dark };
}

export function toggleDark() {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");

  if (isDark) {
    root.classList.remove("dark");
    localStorage.setItem(KEY, "light");
  } else {
    root.classList.add("dark");
    localStorage.setItem(KEY, "dark");
  }

  return !isDark;
}
