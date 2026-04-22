// rfid-dashboard/src/lib/events.js
import { buildEventsStreamUrl } from "@/config/api";

export function subscribeEvents({
  onMetricsChanged,
  onDevicesChanged,
  onScanBatch,
} = {}) {
  const url = buildEventsStreamUrl();

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
