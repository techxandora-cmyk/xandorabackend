// rfid-dashboard/src/lib/events.js
export function subscribeEvents({
  onMetricsChanged,
  onDevicesChanged,
  onScanBatch,
} = {}) {
  const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
  const url = `${base}/events/stream`;

  const es = new EventSource(url, { withCredentials: false });

  const safe = (fn) => (...args) => { try { fn?.(...args); } catch { /* empty */ } };
  es.addEventListener("scan_batch", safe(() => onScanBatch?.()));

  es.addEventListener('hello', () => {
    // console.debug('SSE hello', ev.data);
  });
  
  es.addEventListener('ping', () => {});

  es.addEventListener('metrics_changed', safe(() => onMetricsChanged?.()));
  es.addEventListener('devices_changed', safe(() => onDevicesChanged?.()));

  es.onerror = () => {
    // Browser will auto-retry EventSource; no-op
  };

  return () => {
    try { es.close(); } catch { /* empty */ }
  };
}
