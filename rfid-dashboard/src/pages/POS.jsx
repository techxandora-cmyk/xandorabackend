import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

function fmtTime(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
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
    () => localStorage.getItem("zyro_store_id") || "STORE_001"
  );

  const storeRef = useRef(storeId);
  useEffect(() => {
    storeRef.current = storeId;
  }, [storeId]);

  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingCart, setLoadingCart] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [txRows, setTxRows] = useState([]);
  const [txCount, setTxCount] = useState(0);
  const [txLimit] = useState(50);
  const [txView, setTxView] = useState("all");

  const [cartItems, setCartItems] = useState([]);
  const [cartLimit] = useState(200);
  const [selectedEpcs, setSelectedEpcs] = useState({});
  const [actionMode, setActionMode] = useState("sale");

  async function loadTransactions(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    setLoadingTx(true);
    try {
      const r = await apiGet(
        `/pos?store_id=${encodeURIComponent(sid)}&limit=${encodeURIComponent(
          txLimit
        )}`
      );
      const items = Array.isArray(r?.items) ? r.items : [];
      setTxRows(items);
      setTxCount(Number(r?.count || items.length || 0));
    } catch (e) {
      console.error("[POS] load transactions failed:", e);
      setError(e?.message || "Failed to load POS transactions");
      setTxRows([]);
      setTxCount(0);
    } finally {
      setLoadingTx(false);
    }
  }

  async function loadCartItems(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    setLoadingCart(true);
    try {
      const r = await apiGet(
        `/pos/cart-items?store_id=${encodeURIComponent(
          sid
        )}&limit=${encodeURIComponent(cartLimit)}&hours=24`
      );
      setCartItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      console.error("[POS] load cart-items failed:", e);
      setError(e?.message || "Failed to load recent scanned items");
      setCartItems([]);
    } finally {
      setLoadingCart(false);
    }
  }

  async function refreshAll(activeStoreId) {
    setError("");
    await Promise.all([
      loadTransactions(activeStoreId),
      loadCartItems(activeStoreId),
    ]);
  }

  useEffect(() => {
    refreshAll(storeId);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshAll();
      }
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, txLimit, cartLimit]);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("zyro_store_id") || "STORE_001";
      setStoreId(sid);
      setSelectedEpcs({});
      refreshAll(sid);
    }

    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () => window.removeEventListener("zyro_store_changed", onStoreChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!success) return undefined;
    const id = setTimeout(() => setSuccess(""), 5000);
    return () => clearTimeout(id);
  }, [success]);

  const txTotals = useMemo(() => {
    const rows = Array.isArray(txRows) ? txRows : [];
    let soldItems = 0;
    let returnedItems = 0;
    let grossSales = 0;
    let refunds = 0;

    for (const t of rows) {
      const amount = Number(t?.total_amount || 0);
      const items = Math.abs(Number(t?.total_items || 0));
      const isReturn = txnType(t) === "RETURN";

      if (isReturn) {
        returnedItems += items;
        refunds += Math.abs(amount);
      } else {
        soldItems += items;
        grossSales += amount;
      }
    }

    return {
      txns: rows.length,
      soldItems,
      returnedItems,
      netItems: soldItems - returnedItems,
      grossSales,
      refunds,
      netSales: grossSales - refunds,
    };
  }, [txRows]);

  const txSummary = useMemo(() => {
    let sales = 0;
    let returns = 0;
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

  const selectableItems = useMemo(
    () =>
      cartItems.filter((i) =>
        actionMode === "sale" ? !i?.sold_before : Boolean(i?.sold_before)
      ),
    [cartItems, actionMode]
  );

  const selectedItems = useMemo(
    () => cartItems.filter((i) => selectedEpcs[i.epc]),
    [cartItems, selectedEpcs]
  );

  const selectedTotals = useMemo(() => {
    return {
      count: selectedItems.length,
      totalAmount: selectedItems.reduce(
        (sum, item) => sum + Number(item?.price_lkr || 0),
        0
      ),
    };
  }, [selectedItems]);

  useEffect(() => {
    clearSelection();
  }, [actionMode]);

  function toggleItem(epc) {
    setSelectedEpcs((prev) => ({
      ...prev,
      [epc]: !prev[epc],
    }));
  }

  function selectByMode() {
    const next = {};
    for (const item of selectableItems) {
      next[item.epc] = true;
    }
    setSelectedEpcs(next);
  }

  function clearSelection() {
    setSelectedEpcs({});
  }

  async function checkoutSelected() {
    if (selectedItems.length === 0) {
      setError("Select at least one item to checkout");
      return;
    }

    setCheckoutBusy(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ext_id: `DEMO-${Date.now()}`,
        store_id: storeRef.current,
        items: selectedItems.map((item) => ({
          epc: item.epc,
          price: Number(item?.price_lkr || 0),
        })),
        metadata: {
          source: "dashboard_pos_demo",
          cart_count: selectedItems.length,
        },
      };

      const res = await apiPost("/pos/upload", payload);
      const txnId = res?.transaction?.id;

      setSuccess(
        `Checkout complete${txnId ? ` (Txn #${txnId})` : ""}: ${
          selectedItems.length
        } item(s), ${money(selectedTotals.totalAmount)}`
      );

      clearSelection();
      await refreshAll();
      window.dispatchEvent(new Event("zyro_store_changed"));
    } catch (e) {
      console.error("[POS] checkout failed:", e);
      setError(e?.message || "Checkout failed");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function returnSelected() {
    if (selectedItems.length === 0) {
      setError("Select at least one sold item to return");
      return;
    }

    setCheckoutBusy(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ext_id: `DEMO-RET-${Date.now()}`,
        store_id: storeRef.current,
        items: selectedItems.map((item) => ({
          epc: item.epc,
          price: Number(item?.price_lkr || 0),
        })),
        metadata: {
          source: "dashboard_pos_demo",
          mode: "return",
          cart_count: selectedItems.length,
        },
        reason: "Dashboard return",
      };

      const res = await apiPost("/pos/return", payload);
      const txnId = res?.transaction?.id;

      setSuccess(
        `Return complete${txnId ? ` (Txn #${txnId})` : ""}: ${
          selectedItems.length
        } item(s), ${money(selectedTotals.totalAmount)}`
      );

      clearSelection();
      await refreshAll();
      window.dispatchEvent(new Event("zyro_store_changed"));
    } catch (e) {
      console.error("[POS] return failed:", e);
      setError(e?.message || "Return failed");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">POS</h1>
            <p className="text-xs text-white/50">
              Build a cart from recent scanned EPCs for checkout or return
            </p>
          </div>

          <button
            onClick={() => refreshAll(storeId)}
            className="px-3 py-2 rounded border border-white/10 text-sm hover:bg-white/10"
          >
            {loadingTx || loadingCart ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="mt-2 text-xs text-white/50">
          Store <strong>{storeId}</strong> | Tx loaded <strong>{txCount}</strong>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 text-green-300 px-4 py-3 mb-4 text-sm flex items-start justify-between gap-3">
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess("")}
            className="text-green-300/80 hover:text-green-200 text-xs rounded border border-green-500/30 px-2 py-0.5"
          >
            x
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="glass rounded-xl p-4 border">
          <div className="text-xs text-white/50">Transactions Loaded</div>
          <div className="mt-1 text-2xl font-semibold">{txTotals.txns}</div>
        </div>

        <div className="glass rounded-xl p-4 border">
          <div className="text-xs text-white/50">Net Items</div>
          <div className="mt-1 text-2xl font-semibold">{txTotals.netItems}</div>
          <div className="mt-1 text-[11px] text-white/50">
            Sold {txTotals.soldItems} - Returned {txTotals.returnedItems}
          </div>
        </div>

        <div className="glass rounded-xl p-4 border">
          <div className="text-xs text-white/50">Net Sales</div>
          <div className="mt-1 text-2xl font-semibold">{money(txTotals.netSales)}</div>
          <div className="mt-1 text-[11px] text-white/50">
            Refunds {money(txTotals.refunds)}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-4 border mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">
            Cart Builder (Recent Scanned Items 24h)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActionMode("sale")}
              className={`px-3 py-1 rounded border text-xs ${
                actionMode === "sale"
                  ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                  : "border-white/10 hover:bg-white/10"
              }`}
            >
              Sale
            </button>
            <button
              onClick={() => setActionMode("return")}
              className={`px-3 py-1 rounded border text-xs ${
                actionMode === "return"
                  ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                  : "border-white/10 hover:bg-white/10"
              }`}
            >
              Return
            </button>
            <button
              onClick={selectByMode}
              className="px-3 py-1 rounded border border-white/10 text-xs hover:bg-white/10"
            >
              {actionMode === "sale" ? "Select Unsold" : "Select Sold"}
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-1 rounded border border-white/10 text-xs hover:bg-white/10"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3 text-xs text-white/60">
          <span>Selected: {selectedTotals.count}</span>
          <span>
            {actionMode === "sale" ? "Total" : "Refund"}: {money(selectedTotals.totalAmount)}
          </span>
          <button
            onClick={actionMode === "sale" ? checkoutSelected : returnSelected}
            disabled={checkoutBusy || selectedTotals.count === 0}
            className={`ml-auto px-4 py-2 rounded border disabled:opacity-50 disabled:cursor-not-allowed ${
              actionMode === "sale"
                ? "border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
                : "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            }`}
          >
            {checkoutBusy
              ? actionMode === "sale"
                ? "Checking Out..."
                : "Processing Return..."
              : actionMode === "sale"
              ? "Checkout Selected"
              : "Return Selected"}
          </button>
        </div>

        <div className="overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-left">EPC</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Brand</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-3 py-2 text-left">Price</th>
                <th className="px-3 py-2 text-left">Last Seen</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {cartItems.map((item) => {
                const sold = Boolean(item?.sold_before);
                const selectable = actionMode === "sale" ? !sold : sold;
                const checked = Boolean(selectedEpcs[item.epc]);
                return (
                  <tr
                    key={item.epc}
                    className="border-t border-white/10 hover:bg-white/5"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!selectable}
                        onChange={() => toggleItem(item.epc)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">{item.epc}</td>
                    <td className="px-3 py-2">{item.product_name || "Unmapped item"}</td>
                    <td className="px-3 py-2">{item.brand || "-"}</td>
                    <td className="px-3 py-2">{item.category || "-"}</td>
                    <td className="px-3 py-2">{item.size_label || "-"}</td>
                    <td className="px-3 py-2">{money(item.price_lkr)}</td>
                    <td className="px-3 py-2">{fmtTime(item.last_seen)}</td>
                    <td className="px-3 py-2">
                      {sold ? (
                        <span className="text-amber-300">Sold</span>
                      ) : (
                        <span className="text-emerald-300">In stock</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {cartItems.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-white/40" colSpan={9}>
                    {loadingCart ? "Loading scanned items..." : "No recent scanned items"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">
              {txView === "return" ? "Returns History" : "POS Transactions"}
            </div>
            <div className="text-[11px] text-white/50 mt-1">
              All {txSummary.all} | Sales {txSummary.sales} | Returns {txSummary.returns}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setTxView("all")}
              className={`px-3 py-1 rounded border ${
                txView === "all"
                  ? "border-white/30 bg-white/10"
                  : "border-white/10 hover:bg-white/10"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTxView("sale")}
              className={`px-3 py-1 rounded border ${
                txView === "sale"
                  ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                  : "border-white/10 hover:bg-white/10"
              }`}
            >
              Sales
            </button>
            <button
              onClick={() => setTxView("return")}
              className={`px-3 py-1 rounded border ${
                txView === "return"
                  ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                  : "border-white/10 hover:bg-white/10"
              }`}
            >
              Returns
            </button>
          </div>
        </div>

        {loadingTx && txRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/40">
            Loading POS transactions...
          </div>
        ) : visibleTxRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/40">
            {txView === "return"
              ? "No returns found"
              : txView === "sale"
              ? "No sales found"
              : "No POS transactions found"}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5 text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Ext ID</th>
                  <th className="px-4 py-3 text-left">Store</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Total</th>
                  <th className="px-4 py-3 text-left">Items</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {visibleTxRows.map((t) => {
                  const isReturn = txnType(t) === "RETURN";

                  return (
                    <tr
                      key={t?.id}
                      className="border-t border-white/10 hover:bg-white/5"
                    >
                      <td className="px-4 py-3 font-medium">{t?.ext_id || "-"}</td>
                      <td className="px-4 py-3">{t?.store_id || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={isReturn ? "text-amber-300" : "text-emerald-300"}>
                          {isReturn ? "RETURN" : "SALE"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{money(t?.total_amount)}</td>
                      <td className="px-4 py-3">{t?.total_items ?? 0}</td>
                      <td className="px-4 py-3">{fmtTime(t?.created_at)}</td>
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

