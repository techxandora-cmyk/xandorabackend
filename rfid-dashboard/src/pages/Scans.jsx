// src/pages/Scans.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet } from "@/lib/api";

export default function Scans() {
  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
  );

  const storeRef = useRef(storeId);
  useEffect(() => {
    storeRef.current = storeId;
  }, [storeId]);

  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* =========================
     LOAD SCANS
  ========================= */
  const loadScans = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await apiGet(
        `/scans?store_id=${storeRef.current}&limit=200`
      );

      setScans(res?.scans || []);
    } catch (err) {
      console.error("[Scans]", err);
      setError("Failed to load scans");
    } finally {
      setLoading(false);
    }
  }, []);

  /* =========================
     AUTO REFRESH
  ========================= */
  useEffect(() => {
    loadScans();
    const interval = setInterval(loadScans, 2000);
    return () => clearInterval(interval);
  }, [loadScans]);

  /* =========================
     React to store switch
  ========================= */
  useEffect(() => {
    function onStoreChanged() {
      const sid =
        localStorage.getItem("xandora_store_id") || "STORE_001";
      setStoreId(sid);
      storeRef.current = sid;
      loadScans();
    }

    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () =>
      window.removeEventListener(
        "xandora_store_changed",
        onStoreChanged
      );
  }, [loadScans]);

  return (
    <div className="glass p-6 rounded-xl">
      <h1 className="text-lg font-semibold mb-2">Scans</h1>
      <div className="opacity-60 text-sm mb-4">
        Scan View — stream incoming EPCs.
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && scans.length === 0 && (
        <div className="text-sm opacity-50">
          Loading scans…
        </div>
      )}

      {scans.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">EPC</th>
                <th className="py-2 pr-4">Device</th>
                <th className="py-2 pr-4">RSSI</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-white/5 hover:bg-white/5"
                >
                  <td className="py-2 pr-4 opacity-70">
                    {new Date(s.ts).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {s.tag}
                  </td>
                  <td className="py-2 pr-4 opacity-70">
                    {s.device_id}
                  </td>
                  <td className="py-2 pr-4 opacity-70">
                    {s.rssi ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && scans.length === 0 && (
        <div className="mt-4 text-sm opacity-50">
          No scans yet. Waiting for devices…
        </div>
      )}
    </div>
  );
}
