import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

const PAGE_SIZE = 25;

function formatMetadata(metadata) {
  if (metadata == null) return "-";

  if (typeof metadata === "string") {
    return metadata;
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return "-";
  }
}

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await apiGet(
          `/admin/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
        );

        if (mounted) {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
        }
      } catch (e) {
        console.error(e);
        if (mounted) {
          setError(e?.message || "Failed to load audit logs");
          setLogs([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [page, refreshTick]);

  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Audit Logs</h2>

        <div className="flex gap-2">
          <button
            onClick={() => setRefreshTick((v) => v + 1)}
            className="px-3 py-1 rounded border text-sm"
          >
            Refresh
          </button>

          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1 rounded border text-sm disabled:opacity-40"
          >
            Prev
          </button>

          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded border text-sm"
          >
            Next
          </button>
        </div>
      </div>

      <div className="text-xs opacity-70 mb-3">Page {page + 1}</div>

      {loading ? (
        <div className="text-sm opacity-70">Loading audit logs...</div>
      ) : error ? (
        <div className="text-sm text-red-400">{error}</div>
      ) : logs.length === 0 ? (
        <div className="text-sm opacity-70">No audit activity found</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-70">
                <th className="py-2">Time</th>
                <th className="py-2">User</th>
                <th className="py-2">Action</th>
                <th className="py-2">Entity</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>

            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-white/10">
                  <td className="py-2 whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString()}
                  </td>

                  <td className="py-2">{l.email || "-"}</td>

                  <td className="py-2 font-medium">{l.action}</td>

                  <td className="py-2">
                    {l.entity_type}
                    {l.entity_id ? `:${l.entity_id}` : ""}
                  </td>

                  <td className="py-2 max-w-md truncate">{formatMetadata(l.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
