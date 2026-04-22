export const HOSTED_RENDER_API_BASE_URL =
  "https://xandorabackend-44dt.onrender.com/api/v1";

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return HOSTED_RENDER_API_BASE_URL;
  }
  if (/\/api\/v1$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/api$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return `${trimmed}/api/v1`;
}

const API_BASE = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL || HOSTED_RENDER_API_BASE_URL
);

export function buildApiUrl(path = "") {
  const suffix = String(path || "");
  if (!suffix) {
    return API_BASE;
  }
  return `${API_BASE}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

export function buildEventsStreamUrl() {
  return buildApiUrl("/events/stream");
}

export default API_BASE;
