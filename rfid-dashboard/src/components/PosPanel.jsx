// rfid-dashboard/src/components/PosPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";




function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function money(n) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency: "LKR",
    }).format(v);
  } catch {
    return `LKR ${v.toFixed(2)}`;
  }
}

export default function PosPanel() {
  const auth = useAuth();

  const store_id =
    Array.isArray(auth?.store_ids) && auth.store_ids.length > 0
      ? auth.store_ids[0]
      : "STORE_001";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [items, setItems] = useState([]);
  const [limit, setLimit] = useState(50);

  // optional search filter (by ext_id)
  const [q, setQ] = useState("");

  async function load() {
    setErr("");
    setLoading(true);

    try {
      // Backend route (from our earlier middleware work):
      // GET /api/v1/pos/transactions?store_id=STORE_001&limit=200
      //
      // If your backend route is slightly different, tell me the exact one and I’ll adjust.
      const r = await apiGet(
        `/pos/transactions?store_id=${encodeURIComponent(
          store_id
        )}&limit=${encodeURIComponent(limit)}`
      );

      const rows = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
      setItems(rows);
    } catch (e) {
      console.error("[PosPanel] load failed:", e);
      setItems([]);
      setErr(e?.message || "Failed to load POS transactions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store_id, limit]);

  const filtered = useMemo(() => {
    const rows = Array.isArray(items) ? items : [];
    const s = String(q || "").trim().toLowerCase();
    if (!s) return rows;

    return rows.filter((x) =>
      String(x?.ext_id || "")
        .toLowerCase()
        .includes(s)
    );
  }, [items, q]);

  const totals = useMemo(() => {
    const rows = Array.isArray(filtered) ? filtered : [];
    const totalAmount = rows.reduce(
      (sum, r) => sum + Number(r?.total_amount || 0),
      0
    );
    const totalItems = rows.reduce(
      (sum, r) => sum + Number(r?.total_items || 0),
      0
    );
    return { totalAmount, totalItems, count: rows.length };
  }, [filtered]);

  return (
    <div className="glass rounded-xl p-5 border">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px]">POS Transactions</div>

        <button
          onClick={load}
          className="px-3 py-1 rounded border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="text-sm mb-4">
        <div>
          <span className="text-black/60 dark:text-white/50">Store:</span>{" "}
          <strong>{store_id}</strong>
        </div>

        <div className="mt-1 text-xs text-black/60 dark:text-white/50">
          Showing {totals.count} txn(s) • Items: {totals.totalItems} • Amount:{" "}
          {money(totals.totalAmount)}
        </div>

        {err && <div className="mt-2 text-sm text-red-500">{err}</div>}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <div className="text-xs text-black/60 dark:text-white/50">Limit</div>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-3 py-2 rounded border border-black/10 dark:border-white/10 bg-transparent text-sm"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ext_id…"
          className="min-w-[240px] flex-1 px-3 py-2 rounded border border-black/10 dark:border-white/10 bg-transparent text-sm"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-black/50 dark:text-white/40 text-sm">
          No POS transactions yet
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ext ID</th>
                <th className="px-3 py-2 text-left font-medium">Store</th>
                <th className="px-3 py-2 text-left font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Items</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((txn) => (
                <tr
                  key={txn?.id || txn?.ext_id}
                  className="border-t border-black/10 dark:border-white/10"
                >
                  <td className="px-3 py-2 font-medium">
                    {txn?.ext_id || <span className="text-black/40">—</span>}
                  </td>

                  <td className="px-3 py-2 text-black/60 dark:text-white/50">
                    {txn?.store_id || "—"}
                  </td>

                  <td className="px-3 py-2">{money(txn?.total_amount)}</td>

                  <td className="px-3 py-2 text-black/60 dark:text-white/50">
                    {Number(txn?.total_items || 0)}
                  </td>

                  <td className="px-3 py-2 text-black/60 dark:text-white/50 whitespace-nowrap">
                    {fmtTime(txn?.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
