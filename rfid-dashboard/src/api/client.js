// src/api/client.js
import API_BASE from "@/config/api";

/* =========================
   TOKEN (xandora_jwt safe)
========================= */
function getToken() {
  return (
    localStorage.getItem("xandora_jwt") ||
    sessionStorage.getItem("xandora_jwt") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    null
  );
}

async function fetchJson(path, options = {}) {
  const url = `${API_BASE}${path}`;

  const token = getToken();

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    credentials: "include",
    ...options,
  });

  let body = null;
  try {
    body = await res.json();
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // ignore parse error, will throw below if !res.ok
  }

  if (!res.ok) {
    const message =
      body?.error || `Request failed with ${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

// ---- Metrics ----
export function getMetricsSummary() {
  return fetchJson("/metrics/summary");
}

// ---- Inventory ----
export function getInventorySummary() {
  return fetchJson("/inventory/summary");
}

export function getInventoryTags({ limit = 50, offset = 0 } = {}) {
  return fetchJson(`/inventory/tags?limit=${limit}&offset=${offset}`);
}

export function getInventoryTag(epc) {
  return fetchJson(`/inventory/tags/${encodeURIComponent(epc)}`);
}

// ---- Scans ----
export function getScans({ limit = 200 } = {}) {
  return fetchJson(`/scans?limit=${limit}`);
}

// ---- POS ----
// backend confirmed working: GET /api/v1/pos?store_id=STORE_001&limit=10
export function getPosTransactions({ store_id = "STORE_001", limit = 200 } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (store_id) params.set("store_id", String(store_id));

  return fetchJson(`/pos?${params.toString()}`);
}

// (optional / only if you really have this route)
export function uploadPosTransaction(payload) {
  return fetchJson("/pos/upload", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---- Anomalies / Security ----
export function getAnomalyRules() {
  return fetchJson("/anomalies/rules");
}

export function getAnomaliesSummary() {
  return fetchJson("/anomalies/summary");
}

export function getRecentAnomalies({ limit = 50, status, severity } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));

  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);

  return fetchJson(`/anomalies/recent?${params.toString()}`);
}

export function toggleAnomalyRule(code, enabled) {
  return fetchJson(`/anomalies/rules/${encodeURIComponent(code)}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}
