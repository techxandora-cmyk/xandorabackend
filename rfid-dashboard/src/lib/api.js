// src/lib/api.js
export const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3000";

// ---- Metrics ----
export async function fetchMetrics() {
  const r = await fetch(`${API_BASE}/api/v1/metrics/summary`);
  if (!r.ok) throw new Error(`metrics ${r.status}`);
  return r.json();
}

// ---- Devices ----
export async function fetchDevices() {
  const r = await fetch(`${API_BASE}/api/v1/devices`);
  if (!r.ok) throw new Error(`devices ${r.status}`);
  const json = await r.json();
  // API may return { devices: [...] } or array directly; normalize:
  return Array.isArray(json) ? json : json.devices || [];
}

export async function heartbeatDevice(id) {
  const r = await fetch(`${API_BASE}/api/v1/devices/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!r.ok) throw new Error(`heartbeat ${r.status}`);
  return r.text();
}
