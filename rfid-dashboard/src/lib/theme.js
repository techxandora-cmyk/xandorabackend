// src/lib/theme.js
// Persistent theme + glow state. Applies classes to <html> and <body>.

// Keys
const LS_KEY = "rfid_ui_state";

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLS(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* empty */ }
}

export function applyTheme(state) {
  // dark
  if (state.dark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  // glow
  if (state.glow) {
    document.body.classList.add("glow");
  } else {
    document.body.classList.remove("glow");
  }
}

export function initTheme() {
  // defaults: dark on, glow on
  const defaults = { dark: true, glow: true };
  const saved = readLS();
  const state = { ...defaults, ...(saved || {}) };
  applyTheme(state);
  writeLS(state);
  return state;
}

export function getState() {
  const s = readLS() || { dark: true, glow: true };
  return s;
}

export function setState(next) {
  applyTheme(next);
  writeLS(next);
  return next;
}

export function toggleDark() {
  const s = getState();
  const next = { ...s, dark: !s.dark };
  setState(next);
  return next.dark;
}

export function toggleGlow() {
  const s = getState();
  const next = { ...s, glow: !s.glow };
  setState(next);
  return next.glow;
}
