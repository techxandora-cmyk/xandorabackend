import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

const LIVE_SCAN_WINDOW_MINUTES = 5;

function fmtTime(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function fmtAgo(ts) {
  if (!ts) return "-";
  const diff = Date.now() - Date.parse(ts);
  if (!Number.isFinite(diff)) return "-";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtTime(ts);
}

function money(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "LKR 0.00";
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function txnType(txn) {
  const explicit = String(txn?.metadata?.txn_type || "").toUpperCase();
  if (explicit === "RETURN" || explicit === "REFUND") return "RETURN";
  if (Number(txn?.total_amount || 0) < 0 || Number(txn?.total_items || 0) < 0) {
    return "RETURN";
  }
  return "SALE";
}

export default function POS() {
  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || ""
  );

  const storeRef = useRef(storeId);
  useEffect(() => {
    storeRef.current = storeId;
  }, [storeId]);

  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingCart, setLoadingCart] = useState(false);
  const [error, setError] = useState("");
  const [txRows, setTxRows] = useState([]);
  const [txCount, setTxCount] = useState(0);
  const [txView, setTxView] = useState("all");
  const [cartItems, setCartItems] = useState([]);

  async function loadTransactions(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    if (!sid) return;
    setLoadingTx(true);
    try {
      const r = await apiGet(
        `/pos?store_id=${encodeURIComponent(sid)}&limit=50`
      );
      const items = Array.isArray(r?.items) ? r.items : [];
      setTxRows(items);
      setTxCount(Number(r?.count || items.length || 0));
    } catch (e) {
      setError(e?.message || "Failed to load POS transactions");
      setTxRows([]);
      setTxCount(0);
    } finally {
      setLoadingTx(false);
    }
  }

  async function loadCartItems(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    if (!sid) return;
    setLoadingCart(true);
    try {
      const r = await apiGet(
        `/pos/cart-items?store_id=${encodeURIComponent(sid)}&limit=200&minutes=${LIVE_SCAN_WINDOW_MINUTES}`
      );
      const cutoff = Date.now() - LIVE_SCAN_WINDOW_MINUTES * 60 * 1000;
      const liveItems = Array.isArray(r?.items)
        ? r.items.filter((item) => {
            const seenAt = Date.parse(item?.last_seen);
            return Number.isFinite(seenAt) && seenAt >= cutoff;
          })
        : [];
      setCartItems(liveItems);
    } catch (e) {
      setCartItems([]);
    } finally {
      setLoadingCart(false);
    }
  }

  async function refreshAll(sid) {
    setError("");
    await Promise.all([loadTransactions(sid), loadCartItems(sid)]);
  }

  useEffect(() => {
    refreshAll(storeId);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshAll();
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("xandora_store_id") || "";
      setStoreId(sid);
      refreshAll(sid);
    }
    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const txTotals = useMemo(() => {
    let soldItems = 0, returnedItems = 0, grossSales = 0, refunds = 0;
    for (const t of txRows) {
      const amount = Number(t?.total_amount || 0);
      const items = Math.abs(Number(t?.total_items || 0));
      if (txnType(t) === "RETURN") {
        returnedItems += items;
        refunds += Math.abs(amount);
      } else {
        soldItems += items;
        grossSales += amount;
      }
    }
    return {
      txns: txRows.length,
      soldItems,
      returnedItems,
      netItems: soldItems - returnedItems,
      grossSales,
      refunds,
      netSales: grossSales - refunds,
    };
  }, [txRows]);

  const txSummary = useMemo(() => {
    let sales = 0, returns = 0;
    for (const t of txRows) {
      if (txnType(t) === "RETURN") returns += 1;
      else sales += 1;
    }
    return { all: txRows.length, sales, returns };
  }, [txRows]);

  const visibleTxRows = useMemo(() => {
    if (txView === "sale") return txRows.filter((t) => txnType(t) === "SALE");
    if (txView === "return") return txRows.filter((t) => txnType(t) === "RETURN");
    return txRows;
  }, [txRows, txView]);

  const scannedItems = useMemo(() => {
    const inStock = cartItems.filter((i) => !i?.sold_before);
    const sold = cartItems.filter((i) => i?.sold_before);
    return { inStock, sold, total: cartItems.length };
  }, [cartItems]);

  const isLoading = loadingTx || loadingCart;

  return (
    <div className="space-y-6">

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4 border">
          <div className="text-xs opacity-55">Transactions Loaded</div>
          <div className="mt-1 text-2xl font-semibold">{txTotals.txns}</div>
          <div className="text-[11px] opacity-45 mt-1">
            {txSummary.sales} sales · {txSummary.returns} returns
          </div>
        </div>
        <div className="glass rounded-xl p-4 border">
          <div className="text-xs opacity-55">Net Items Sold</div>
          <div className="mt-1 text-2xl font-semibold">{txTotals.netItems}</div>
          <div className="text-[11px] opacity-45 mt-1">
            Sold {txTotals.soldItems} · Returned {txTotals.returnedItems}
          </div>
        </div>
        <div className="glass rounded-xl p-4 border">
          <div className="text-xs opacity-55">Net Sales</div>
          <div className="mt-1 text-2xl font-semibold">{money(txTotals.netSales)}</div>
          <div className="text-[11px] opacity-45 mt-1">
            Refunds {money(txTotals.refunds)}
          </div>
        </div>
      </div>

      {/* Scanned Items Summary */}
      <div className="glass rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">Live Scanned Items</div>
            <div className="text-[11px] opacity-50 mt-0.5">
              RFID tags read in the last {LIVE_SCAN_WINDOW_MINUTES} minutes — {scannedItems.total} items detected
            </div>
          </div>
          <button
            type="button"
            onClick={() => refreshAll(storeId)}
            disabled={isLoading}
            className="rounded border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5">
            <div className="text-[11px] opacity-70">In Stock</div>
            <div className="text-xl font-semibold text-emerald-400 mt-0.5">
              {scannedItems.inStock.length}
            </div>
            <div className="text-[10px] opacity-50 mt-0.5">Available to sell</div>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
            <div className="text-[11px] opacity-70">Already Sold</div>
            <div className="text-xl font-semibold text-amber-400 mt-0.5">
              {scannedItems.sold.length}
            </div>
            <div className="text-[10px] opacity-50 mt-0.5">Processed through POS</div>
          </div>
        </div>

        {cartItems.length > 0 && (
          <div className="overflow-auto rounded-lg border border-white/10 max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-white/5 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left opacity-60">EPC</th>
                  <th className="px-3 py-2 text-left opacity-60">Product</th>
                  <th className="px-3 py-2 text-left opacity-60">Brand</th>
                  <th className="px-3 py-2 text-left opacity-60">Size</th>
                  <th className="px-3 py-2 text-left opacity-60">Price</th>
                  <th className="px-3 py-2 text-left opacity-60">Last Seen</th>
                  <th className="px-3 py-2 text-left opacity-60">Status</th>
                </tr>
              </thead>
              <tbody>
                {cartItems.map((item) => (
                  <tr key={item.epc} className="border-t border-white/8 hover:bg-white/5">
                    <td className="px-3 py-2 font-mono opacity-70">{item.epc}</td>
                    <td className="px-3 py-2">{item.product_name || "Unmapped item"}</td>
                    <td className="px-3 py-2 opacity-70">{item.brand || "-"}</td>
                    <td className="px-3 py-2 opacity-70">{item.size_label || "-"}</td>
                    <td className="px-3 py-2">{money(item.price_lkr)}</td>
                    <td className="px-3 py-2 opacity-60">{fmtAgo(item.last_seen)}</td>
                    <td className="px-3 py-2">
                      {item?.sold_before ? (
                        <span className="text-amber-400">Sold</span>
                      ) : (
                        <span className="text-emerald-400">In stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cartItems.length === 0 && !loadingCart && (
          <div className="text-xs opacity-40 py-2">No items scanned in the last 24 hours</div>
        )}
      </div>

      {/* Transaction History */}
      <div className="glass rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">POS Transaction History</div>
            <div className="text-[11px] opacity-50 mt-0.5">
              Transactions recorded by your POS system ·{" "}
              {txCount} loaded
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setTxView("all")}
              className={`px-3 py-1.5 rounded border transition ${
                txView === "all"
                  ? "border-white/30 bg-white/10"
                  : "border-white/10 hover:bg-white/5"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTxView("sale")}
              className={`px-3 py-1.5 rounded border transition ${
                txView === "sale"
                  ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                  : "border-white/10 hover:bg-white/5"
              }`}
            >
              Sales
            </button>
            <button
              onClick={() => setTxView("return")}
              className={`px-3 py-1.5 rounded border transition ${
                txView === "return"
                  ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                  : "border-white/10 hover:bg-white/5"
              }`}
            >
              Returns
            </button>
          </div>
        </div>

        {loadingTx && txRows.length === 0 ? (
          <div className="px-5 py-8 text-sm opacity-40">Loading transactions...</div>
        ) : visibleTxRows.length === 0 ? (
          <div className="px-5 py-8 text-sm opacity-40">
            {txView === "return" ? "No returns found" : txView === "sale" ? "No sales found" : "No transactions found"}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left opacity-60">Transaction ID</th>
                  <th className="px-4 py-3 text-left opacity-60">Store</th>
                  <th className="px-4 py-3 text-left opacity-60">Type</th>
                  <th className="px-4 py-3 text-left opacity-60">Amount</th>
                  <th className="px-4 py-3 text-left opacity-60">Items</th>
                  <th className="px-4 py-3 text-left opacity-60">Time</th>
                </tr>
              </thead>
              <tbody>
                {visibleTxRows.map((t) => {
                  const isReturn = txnType(t) === "RETURN";
                  return (
                    <tr key={t?.id} className="border-t border-white/8 hover:bg-white/5">
                      <td className="px-4 py-3 font-mono opacity-70">{t?.ext_id || "-"}</td>
                      <td className="px-4 py-3 opacity-70">{t?.store_id || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={isReturn ? "text-amber-400" : "text-emerald-400"}>
                          {isReturn ? "Return" : "Sale"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{money(t?.total_amount)}</td>
                      <td className="px-4 py-3 opacity-70">{t?.total_items ?? 0}</td>
                      <td className="px-4 py-3 opacity-60">{fmtAgo(t?.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
