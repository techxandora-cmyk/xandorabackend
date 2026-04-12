import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function Stock() {
  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("zyro_store_id") || "STORE_001"
  );

  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("stock_priority");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  const [lastFilters, setLastFilters] = useState({
    q: null,
    brand: null,
    barcode: null,
  });
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  const [detailLoadingKey, setDetailLoadingKey] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailsByGroup, setDetailsByGroup] = useState({});

  const loadStock = useCallback(
    async (overrides = {}) => {
      const qValue = String(overrides.q ?? q).trim();
      const brandValue = String(overrides.brand ?? brand).trim();
      const barcodeValue = String(overrides.barcode ?? barcode).trim();
      const sid = String(overrides.store_id || storeId);

      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          store_id: sid,
          limit: "200",
        });

        if (qValue) params.set("q", qValue);
        if (brandValue) params.set("brand", brandValue);
        if (barcodeValue) params.set("barcode", barcodeValue);

        const res = await apiGet(`/stock/search?${params.toString()}`);

        setRows(Array.isArray(res?.items) ? res.items : []);
        setLastFilters({
          q: qValue || null,
          brand: brandValue || null,
          barcode: barcodeValue || null,
        });
        setExpandedGroupKey("");
        setDetailLoadingKey("");
        setDetailError("");
        setDetailsByGroup({});
      } catch (e) {
        console.error("[Stock] load failed:", e);
        if (e?.status === 404) {
          setError("Stock API route not found. Restart backend server and retry.");
        } else {
          setError(e?.message || "Failed to search stock");
        }
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [q, brand, barcode, storeId]
  );

  useEffect(() => {
    loadStock({ q: "", brand: "", barcode: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("zyro_store_id") || "STORE_001";
      setStoreId(sid);
    }

    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () => window.removeEventListener("zyro_store_changed", onStoreChanged);
  }, []);

  function onSubmit(e) {
    e.preventDefault();
    loadStock();
  }

  function clearFilters() {
    setQ("");
    setBrand("");
    setBarcode("");
    setStatusFilter("all");
    setSortBy("stock_priority");
    loadStock({ q: "", brand: "", barcode: "" });
  }

  function rowGroupKey(row, idx) {
    const fallback = [
      row?.barcode || "",
      row?.sku || "",
      row?.product_name || "",
      row?.brand || "",
      row?.category || "",
      row?.size_label || "",
      row?.color || "",
      idx,
    ].join("|");
    return row?.group_key || `fallback:${fallback}`;
  }

  const statusBucket = useCallback((row) => {
    const inStock = toNum(row?.in_stock_count) > 0;
    const sold = toNum(row?.sold_count) > 0;
    const returned = toNum(row?.returned_count) > 0;

    if (inStock) return 0; // Unsold available first
    if (sold) return 1; // Then sold
    if (returned) return 2; // Then returned
    return 3;
  }, []);

  const rowStatus = useCallback((row) => {
    const bucket = statusBucket(row);
    if (bucket === 0) {
      return {
        label: "UNSOLD",
        className: "border-emerald-500/40 text-emerald-300",
      };
    }
    if (bucket === 1) {
      return {
        label: "SOLD",
        className: "border-amber-500/40 text-amber-300",
      };
    }
    if (bucket === 2) {
      return {
        label: "RETURNED",
        className: "border-cyan-500/40 text-cyan-300",
      };
    }
    return {
      label: "N/A",
      className: "border-white/20 text-white/70",
    };
  }, [statusBucket]);

  const rowsFilteredSorted = useMemo(() => {
    let out = Array.isArray(rows) ? [...rows] : [];

    if (statusFilter === "unsold") {
      out = out.filter((r) => toNum(r?.in_stock_count) > 0);
    } else if (statusFilter === "sold") {
      out = out.filter((r) => toNum(r?.sold_count) > 0);
    } else if (statusFilter === "returned") {
      out = out.filter((r) => toNum(r?.returned_count) > 0);
    }

    const byText = (a, b, key, dir = 1) =>
      String(a?.[key] || "").localeCompare(String(b?.[key] || "")) * dir;

    out.sort((a, b) => {
      if (sortBy === "product_az") {
        return (
          byText(a, b, "product_name", 1) ||
          byText(a, b, "brand", 1) ||
          byText(a, b, "sku", 1)
        );
      }

      if (sortBy === "product_za") {
        return (
          byText(a, b, "product_name", -1) ||
          byText(a, b, "brand", -1) ||
          byText(a, b, "sku", -1)
        );
      }

      if (sortBy === "brand_az") {
        return (
          byText(a, b, "brand", 1) ||
          byText(a, b, "product_name", 1) ||
          byText(a, b, "sku", 1)
        );
      }

      return (
        statusBucket(a) - statusBucket(b) ||
        byText(a, b, "product_name", 1) ||
        byText(a, b, "sku", 1)
      );
    });

    return out;
  }, [rows, sortBy, statusFilter, statusBucket]);

  const displaySummary = useMemo(() => {
    return rowsFilteredSorted.reduce(
      (acc, row) => {
        acc.products += 1;
        acc.total_tags += toNum(row?.total_tags);
        acc.in_stock_tags += toNum(row?.in_stock_count);
        acc.sold_tags += toNum(row?.sold_count);
        acc.returned_tags += toNum(row?.returned_count);
        return acc;
      },
      {
        products: 0,
        total_tags: 0,
        in_stock_tags: 0,
        sold_tags: 0,
        returned_tags: 0,
      }
    );
  }, [rowsFilteredSorted]);

  async function loadDetails(groupKey) {
    setDetailLoadingKey(groupKey);
    setDetailError("");
    try {
      const params = new URLSearchParams({
        store_id: storeId,
        group_key: groupKey,
        limit: "1000",
      });
      const res = await apiGet(`/stock/epcs?${params.toString()}`);

      setDetailsByGroup((prev) => ({
        ...prev,
        [groupKey]: {
          summary: res?.summary || {
            total_tags: 0,
            in_stock_tags: 0,
            sold_tags: 0,
            returned_tags: 0,
          },
          items: Array.isArray(res?.items) ? res.items : [],
          count: Number(res?.count || 0),
        },
      }));
    } catch (e) {
      console.error("[Stock] details load failed:", e);
      if (e?.status === 404) {
        setDetailError("Stock EPC detail route not found. Restart backend server.");
      } else {
        setDetailError(e?.message || "Failed to load EPC details");
      }
    } finally {
      setDetailLoadingKey("");
    }
  }

  async function toggleDetails(row, idx) {
    const key = rowGroupKey(row, idx);

    if (expandedGroupKey === key) {
      setExpandedGroupKey("");
      setDetailError("");
      return;
    }

    setExpandedGroupKey(key);
    setDetailError("");

    if (!detailsByGroup[key]) {
      await loadDetails(key);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <p className="text-sm text-white/60">
          Live stock visibility by barcode, EPC, SKU, brand, or product name
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100/90">
        Stock visibility stays in Retail. Controlled counts, audits, and reconciliation live in
        Xandora Stock Audit.
      </div>

      {error ? (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="mb-6 rounded-xl border border-white/10 bg-black/40 p-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Master search: barcode / EPC / SKU / product"
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Filter by brand"
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Barcode filter"
            className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/60">Status:</span>
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="All"
          />
          <FilterChip
            active={statusFilter === "unsold"}
            onClick={() => setStatusFilter("unsold")}
            label="Unsold"
          />
          <FilterChip
            active={statusFilter === "sold"}
            onClick={() => setStatusFilter("sold")}
            label="Sold"
          />
          <FilterChip
            active={statusFilter === "returned"}
            onClick={() => setStatusFilter("returned")}
            label="Returned"
          />

          <span className="ml-2 text-xs text-white/60">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-xs"
          >
            <option value="stock_priority">Unsold - Sold - Returned</option>
            <option value="product_az">Product A-Z</option>
            <option value="product_za">Product Z-A</option>
            <option value="brand_az">Brand A-Z</option>
          </select>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            className="rounded border border-purple-500/40 px-4 py-2 text-sm text-purple-300 hover:bg-purple-500/10"
            disabled={loading}
          >
            {loading ? "Searching..." : "Search"}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
            disabled={loading}
          >
            Clear
          </button>
          <div className="ml-auto text-xs text-white/50">
            Store <strong>{storeId}</strong>
          </div>
        </div>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Card title="Products" value={displaySummary.products} />
        <Card title="Total Tagged" value={displaySummary.total_tags} />
        <Card title="In Stock" value={displaySummary.in_stock_tags} />
        <Card title="Sold" value={displaySummary.sold_tags} />
        <Card title="Returned" value={displaySummary.returned_tags} />
      </div>

      <div className="mb-3 text-xs text-white/50">
        Filters: q={lastFilters.q || "-"} | brand={lastFilters.brand || "-"} | barcode=
        {lastFilters.barcode || "-"} | status={statusFilter} | sort={sortBy}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">
          Stock Search Results
        </div>

        {loading && rowsFilteredSorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/50">Loading stock data...</div>
        ) : rowsFilteredSorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/50">No matching stock items</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5 text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Barcode</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Brand</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">In Stock</th>
                  <th className="px-4 py-3 text-right">Sold</th>
                  <th className="px-4 py-3 text-right">Returned</th>
                </tr>
              </thead>
              <tbody>
                {rowsFilteredSorted.map((r, idx) => {
                  const key = rowGroupKey(r, idx);
                  const open = expandedGroupKey === key;
                  const details = detailsByGroup[key];
                  const detailLoading = detailLoadingKey === key;
                  const status = rowStatus(r);

                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-white/10 hover:bg-white/5">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleDetails(r, idx)}
                            className={`rounded border px-3 py-1 text-[11px] transition ${
                              open
                                ? "border-cyan-500/50 text-cyan-300 bg-cyan-500/10"
                                : "border-white/15 hover:bg-white/10"
                            }`}
                          >
                            {open ? "Hide EPCs" : "View EPCs"}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono">{r.barcode || "-"}</td>
                        <td className="px-4 py-3">{r.sku || "-"}</td>
                        <td className="px-4 py-3">{r.product_name || "Unmapped item"}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">{r.brand || "-"}</td>
                        <td className="px-4 py-3">{r.category || "-"}</td>
                        <td className="px-4 py-3">{r.size_label || "-"}</td>
                        <td className="px-4 py-3 text-right">{r.total_tags || 0}</td>
                        <td className="px-4 py-3 text-right text-emerald-300">
                          {r.in_stock_count || 0}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-300">
                          {r.sold_count || 0}
                        </td>
                        <td className="px-4 py-3 text-right text-cyan-300">
                          {r.returned_count || 0}
                        </td>
                      </tr>

                      {open ? (
                        <tr className="border-t border-white/10 bg-white/[0.02]">
                          <td colSpan={12} className="px-4 py-4">
                            {detailLoading && !details ? (
                              <div className="text-xs text-white/50">Loading EPC details...</div>
                            ) : detailError ? (
                              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                                {detailError}
                              </div>
                            ) : details && details.items.length > 0 ? (
                              <div>
                                <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                                  <MiniCard title="Total Tags" value={details.summary.total_tags} />
                                  <MiniCard title="In Stock" value={details.summary.in_stock_tags} />
                                  <MiniCard title="Sold" value={details.summary.sold_tags} />
                                  <MiniCard title="Returned" value={details.summary.returned_tags} />
                                </div>

                                <div className="overflow-auto rounded border border-white/10">
                                  <table className="w-full text-[11px]">
                                    <thead className="bg-white/5 text-white/60">
                                      <tr>
                                        <th className="px-3 py-2 text-left">EPC</th>
                                        <th className="px-3 py-2 text-left">State</th>
                                        <th className="px-3 py-2 text-right">Sold Balance</th>
                                        <th className="px-3 py-2 text-right">Return Events</th>
                                        <th className="px-3 py-2 text-right">Price</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...details.items]
                                        .sort((a, b) => {
                                          const stateRank = (state) =>
                                            state === "IN_STOCK"
                                              ? 0
                                              : state === "SOLD"
                                                ? 1
                                                : state === "RETURNED"
                                                  ? 2
                                                  : 3;
                                          return (
                                            stateRank(a.stock_state) - stateRank(b.stock_state) ||
                                            String(a.epc || "").localeCompare(
                                              String(b.epc || "")
                                            )
                                          );
                                        })
                                        .map((item) => (
                                        <tr
                                          key={item.epc}
                                          className="border-t border-white/10 hover:bg-white/5"
                                        >
                                          <td className="px-3 py-2 font-mono">{item.epc}</td>
                                          <td className="px-3 py-2">
                                            <span
                                              className={
                                                item.stock_state === "SOLD"
                                                  ? "text-amber-300"
                                                  : item.stock_state === "RETURNED"
                                                  ? "text-cyan-300"
                                                  : "text-emerald-300"
                                              }
                                            >
                                              {item.stock_state}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            {item.sold_balance || 0}
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            {item.return_events || 0}
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            {Number(item.price_lkr || 0).toFixed(2)}
                                          </td>
                                        </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-white/50">No EPC details available</div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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

function Card({ title, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4">
      <div className="text-xs text-white/50">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value ?? 0}</div>
    </div>
  );
}

function FilterChip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-purple-500/50 bg-purple-500/10 text-purple-300"
          : "border-white/15 text-white/80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function MiniCard({ title, value }) {
  return (
    <div className="rounded border border-white/10 bg-black/40 px-3 py-2">
      <div className="text-[11px] text-white/50">{title}</div>
      <div className="mt-1 text-sm font-semibold">{value ?? 0}</div>
    </div>
  );
}
