// src/lib/api.js
import API_BASE from "@/config/api";

const BASE_URL = API_BASE;
const REQUEST_TIMEOUT_MS = Math.min(
  Math.max(Number(import.meta.env.VITE_API_TIMEOUT_MS || 20000), 2000),
  60000
);

function getToken() {
  return (
    localStorage.getItem("zyro_jwt") ||
    sessionStorage.getItem("zyro_jwt")
  );
}

async function request(method, url, body, options = {}) {
  const token = getToken();
  const timeoutMs = Math.min(
    Math.max(Number(options?.timeoutMs || REQUEST_TIMEOUT_MS), 500),
    60000
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${BASE_URL}${url}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const aborted =
      err?.name === "AbortError" ||
      /aborted|timeout/i.test(String(err?.message || ""));
    const error = new Error(
      aborted ? `Request timed out after ${timeoutMs}ms` : "Failed to fetch"
    );
    error.status = 0;
    error.error = error.message;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data?.error || "Request failed");
    error.status = res.status;
    error.error = data?.error;
    throw error;
  }

  return data;
}

export function apiGet(url) {
  return request("GET", url);
}

export function apiPost(url, body) {
  return request("POST", url, body);
}

export function apiPut(url, body) {
  return request("PUT", url, body);
}

export function apiDelete(url) {
  return request("DELETE", url);
}
