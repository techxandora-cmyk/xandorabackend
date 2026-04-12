// rfid-dashboard/src/lib/live.js
import API_BASE from "@/config/api";


export function subscribeEvents({
  onUpdate,
  onHeartbeat,
  onPosConfirmed,
  onOpen,
  onError,
} = {}) {
  const es = new EventSource(`${API_BASE}/events/stream`);

  es.addEventListener("hello", (e) => onOpen?.(e));
  es.addEventListener("ping",  () => {});

  es.addEventListener("device_update", (e) => {
    try { onUpdate?.(JSON.parse(e.data)); } catch { /* empty */ }
  });

  es.addEventListener("device_heartbeat", (e) => {
    try { onHeartbeat?.(JSON.parse(e.data)); } catch { /* empty */ }
  });

  // NEW: POS live event
  es.addEventListener("pos_confirmed", (e) => {
    try { onPosConfirmed?.(JSON.parse(e.data)); } catch { /* empty */ }
  });

  es.onerror = (e) => onError?.(e);

  return () => es.close();
}
