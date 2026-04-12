// src/pages/ScansListPage.jsx
import { useEffect, useState } from "react";
import { getScans } from "../api/client";

export default function ScansListPage() {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const res = await getScans({ limit: 200 });
        if (!cancelled) setScans(res.scans || res.items || []);
      } catch (err) {
        console.error("[ScansListPage] load error:", err);
        if (!cancelled) {
          setError(err.message || "Failed to load scans");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Scans</h1>
        <div className="text-xs text-gray-500">
          {scans.length} scan(s)
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="border rounded-xl bg-white/70 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                Tag (EPC)
              </th>
              <th className="px-3 py-2 text-left font-medium">
                Device
              </th>
              <th className="px-3 py-2 text-left font-medium">
                Store
              </th>
              <th className="px-3 py-2 text-left font-medium">
                Time
              </th>
              <th className="px-3 py-2 text-left font-medium">
                RSSI
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && scans.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-3 text-center text-gray-400"
                >
                  Loading...
                </td>
              </tr>
            ) : scans.length ? (
              scans.map((scan) => (
                <tr key={scan.id} className="border-t">
                  <td className="px-3 py-2 font-mono">
                    {scan.tag}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {scan.device_id || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {scan.store_id || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {scan.ts
                      ? new Date(scan.ts).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {typeof scan.rssi === "number"
                      ? `${scan.rssi} dBm`
                      : "—"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-3 text-center text-gray-400"
                >
                  No scans yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
