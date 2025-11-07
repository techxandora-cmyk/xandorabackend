// rfid-dashboard/src/lib/theme.js
// Simple, reliable theme state: dark only (glow is always-on via CSS)
const KEY = "aurora_theme_v1";

export function initTheme() {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  const dark = !!saved.dark;
  document.documentElement.classList.toggle("dark", dark);
  // body class for any light tweaks
  document.body.classList.toggle("light-override", !dark);
  return { dark };
}

export function toggleDark() {
  const nowDark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", nowDark);
  document.body.classList.toggle("light-override", !nowDark);
  localStorage.setItem(KEY, JSON.stringify({ dark: nowDark }));
  return { dark: nowDark };
}

export function getState() {
  return {
    dark: document.documentElement.classList.contains("dark"),
  };
}
