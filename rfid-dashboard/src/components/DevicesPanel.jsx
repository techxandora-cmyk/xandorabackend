import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

function timeAgo(ts) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
}

function statusMeta(status) {
  switch (status) {
    case "offline":
      return {
        label: "OFFLINE",
        color: "border-l-red-500",
        badge: "bg-red-500/15 text-red-400",
        weight: 0,
      };
    case "unknown":
      return {
        label: "UNKNOWN",
        color: "border-l-yellow-400",
        badge: "bg-yellow-400/15 text-yellow-300",
        weight: 1,
      };
    default:
      return {
        label: "ONLINE",
        color: "border-l-green-500",
        badge: "bg-green-500/15 text-green-400",
        weight: 2,
      };
  }
}

export default function DevicesPanel() {
  /* =========================
     ACTIVE STORE (REACTIVE)
  ========================= */
  const [storeId, setStoreId] = useState(() => {
    return localStorage.getItem("zyro_store_id") || "STORE_001";
  });

  const storeRef = useRef(storeId);
  useEffect(() => {
    storeRef.current = storeId;
  }, [storeId]);

  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(activeStoreId) {
    const sid = activeStoreId || storeRef.current;

    setError("");
    setLoading(true);

    try {
      const r = await apiGet(
        `/devices?store_id=${encodeURIComponent(sid)}`
      );
      setDevices(Array.isArray(r?.devices) ? r.devices : []);
    } catch (e) {
      console.error("[DevicesPanel] load failed:", e);
      setError("Failed to load devices");
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     INITIAL LOAD + POLLING
  ========================= */
  useEffect(() => {
    load(storeId);

    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        load();
      }
    }, 8000);

    return () => clearInterval(id);
  }, [storeId]);

  /* =========================
     STORE SWITCH LISTENER
  ========================= */
  useEffect(() => {
    function onStoreChanged() {
      const sid =
        localStorage.getItem("zyro_store_id") || "STORE_001";
      setStoreId(sid);
      load(sid);
    }

    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () =>
      window.removeEventListener("zyro_store_changed", onStoreChanged);
  }, []);

  const sorted = useMemo(() => {
    return [...devices].sort((a, b) => {
      const wa = statusMeta(a.status).weight;
      const wb = statusMeta(b.status).weight;
      return wa - wb;
    });
  }, [devices]);

  return (
    <div className="glass rounded-xl p-5 border space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Devices</div>
        <div className="text-xs text-black/50 dark:text-white/40">
          {devices.length} total • Store <strong>{storeId}</strong>
        </div>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}

      {loading ? (
        <div className="text-xs text-black/40 dark:text-white/30">
          Loading devices…
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-xs text-black/40 dark:text-white/30">
          No devices found
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((d) => {
            const meta = statusMeta(d.status);

            return (
              <div
                key={d.device_id}
                className={`border-l-4 ${meta.color} rounded-lg px-4 py-3 bg-black/5 dark:bg-white/5`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {d.device_id}
                    </div>
                    <div className="text-[11px] text-black/50 dark:text-white/40">
                      Store: {d.store_id}
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`text-[11px] px-2 py-0.5 rounded-full inline-block ${meta.badge}`}
                    >
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-black/40 dark:text-white/30 mt-1">
                      Last seen: {timeAgo(d.last_seen)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
