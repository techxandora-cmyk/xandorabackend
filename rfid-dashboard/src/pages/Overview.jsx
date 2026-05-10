import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import MasterAdminOverview from "@/pages/MasterAdminOverview";

function normalizeCompanyView(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (
    upper === "GLOBAL" ||
    upper === "GLOBAL_VIEW" ||
    upper === "GLOBAL VIEW" ||
    upper === "XANDORA"
  ) {
    return "";
  }
  return value;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatLkr(value) {
  const n = toNumber(value);
  try {
    return new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency: "LKR",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `LKR ${n.toFixed(2)}`;
  }
}

function isReturnTransaction(txn) {
  const txnType = String(txn?.metadata?.txn_type || "").toUpperCase();
  return (
    txnType === "RETURN" ||
    txnType === "REFUND" ||
    toNumber(txn?.total_amount) < 0 ||
    toNumber(txn?.total_items) < 0
  );
}

function formatEventType(eventType) {
  return String(eventType || "event")
    .replace(/_/g, " ")
    .trim()
    .toUpperCase();
}

function formatActivityTime(ts) {
  const ms = Date.parse(ts || "");
  if (!Number.isFinite(ms)) return "just now";

  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  }
  return new Date(ms).toLocaleString();
}

function formatClockTime(ts) {
  if (!ts) return "--:--:--";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "--:--:--";
  return new Date(ms).toLocaleTimeString();
}

function readActiveStoreId() {
  return String(localStorage.getItem("xandora_store_id") || "")
    .trim()
    .toUpperCase();
}

function activityToneClass(eventType) {
  const normalized = String(eventType || "").toUpperCase();

  if (normalized.includes("RETURN") || normalized.includes("REFUND")) {
    return "border-amber-500/40 text-amber-300";
  }
  if (normalized.includes("SALE") || normalized.includes("CHECKOUT")) {
    return "border-emerald-500/40 text-emerald-300";
  }
  if (normalized.includes("ALERT") || normalized.includes("ERROR")) {
    return "border-rose-500/40 text-rose-300";
  }
  if (normalized.includes("SCAN")) {
    return "border-cyan-500/40 text-cyan-300";
  }
  return "border-purple-500/40 text-purple-300";
}

function buildActivityMessage(evt) {
  const eventName = String(evt?.event || "event").toUpperCase();
  const data = evt?.data && typeof evt.data === "object" ? evt.data : {};
  const epc = data.epc || data.tag || data.item_epc || "";

  if (eventName.includes("POS_RETURN")) {
    return `POS return captured${epc ? ` (${epc})` : ""}`;
  }
  if (eventName.includes("POS_SALE")) {
    return `POS sale captured${epc ? ` (${epc})` : ""}`;
  }
  if (eventName.includes("SCAN")) {
    return `RFID scan detected${epc ? ` (${epc})` : ""}`;
  }
  if (eventName.includes("ALERT")) {
    return `Alert raised${epc ? ` (${epc})` : ""}`;
  }

  return `${formatEventType(eventName)}${epc ? ` (${epc})` : ""}`;
}

function brandLabel(value) {
  const label = String(value || "").trim();
  return label || "Unbranded";
}

function normalizeBrandRiskRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    brand: brandLabel(row?.brand),
    low_stock_units: Math.max(0, toNumber(row?.low_stock_units)),
    out_of_stock_demand_units: Math.max(
      0,
      toNumber(row?.out_of_stock_demand_units)
    ),
    high_return_sold_units: Math.max(0, toNumber(row?.high_return_sold_units)),
    never_scanned_units: Math.max(0, toNumber(row?.never_scanned_units)),
    at_risk_units: Math.max(0, toNumber(row?.at_risk_units)),
    max_no_scan_days: Math.max(0, Math.floor(toNumber(row?.max_no_scan_days))),
  }));
}

function buildBrandRiskRows(items = []) {
  const byBrand = new Map();
  for (const item of items) {
    const brand = brandLabel(item?.brand);
    const inStock = Math.max(0, toNumber(item?.in_stock_count));
    const sold = Math.max(0, toNumber(item?.sold_count));
    const days =
      item?.days_since_scan == null
        ? 7
        : Math.max(0, Math.floor(toNumber(item?.days_since_scan)));

    const prev = byBrand.get(brand) || {
      brand,
      low_stock_units: 0,
      out_of_stock_demand_units: 0,
      high_return_sold_units: 0,
      never_scanned_units: 0,
      at_risk_units: 0,
      max_no_scan_days: 0,
    };

    if (item?.risk_low_stock) {
      prev.low_stock_units += inStock;
    }
    if (item?.risk_out_of_stock) {
      prev.out_of_stock_demand_units += sold;
    }
    if (item?.risk_high_return_rate) {
      prev.high_return_sold_units += sold;
    }
    if (item?.risk_never_scanned_7d) {
      prev.never_scanned_units += inStock;
      prev.max_no_scan_days = Math.max(prev.max_no_scan_days, days);
    }

    if (
      item?.risk_low_stock ||
      item?.risk_out_of_stock ||
      item?.risk_high_return_rate ||
      item?.risk_never_scanned_7d
    ) {
      prev.at_risk_units += inStock + sold;
    }

    byBrand.set(brand, prev);
  }

  return Array.from(byBrand.values());
}

function topBrandNamesByMetric(rows, key, limit = 3) {
  return (rows || [])
    .filter((row) => toNumber(row?.[key]) > 0)
    .sort((a, b) => toNumber(b?.[key]) - toNumber(a?.[key]))
    .slice(0, limit)
    .map((row) => row.brand);
}

function dormantBrandBreakdown(rows, limit = 5) {
  return (rows || [])
    .filter((row) => toNumber(row?.never_scanned_units) > 0)
    .sort(
      (a, b) =>
        toNumber(b?.never_scanned_units) - toNumber(a?.never_scanned_units) ||
        toNumber(b?.max_no_scan_days) - toNumber(a?.max_no_scan_days)
    )
    .map((row) => ({
      brand: row.brand,
      units: toNumber(row?.never_scanned_units),
      max_days: toNumber(row?.max_no_scan_days),
    }))
    .slice(0, limit);
}

function priorityBrandBreakdown(rows, limit = 3) {
  return (rows || [])
    .map((row) => {
      const low = toNumber(row?.low_stock_units);
      const out = toNumber(row?.out_of_stock_demand_units);
      const high = toNumber(row?.high_return_sold_units);
      const never = toNumber(row?.never_scanned_units);

      const score =
        (out > 0 ? 5 : 0) +
        (high > 0 ? 4 : 0) +
        (low > 0 ? 3 : 0) +
        (never > 0 ? 2 : 0);

      const units = Math.max(
        toNumber(row?.at_risk_units),
        out + high + low + never
      );

      return { brand: row.brand, score, units };
    })
    .filter((row) => row.score > 0 && row.units > 0)
    .sort((a, b) => b.score - a.score || b.units - a.units)
    .slice(0, limit)
    .map((row) => ({ brand: row.brand, units: row.units }));
}

/* =========================
   SIMPLE SVG LINE CHART
========================= */
function MiniLineChart({ data = [] }) {
  if (!data.length) return <div className="text-xs opacity-40">No data</div>;

  const width = 240;
  const height = 80;
  const max = Math.max(...data, 1);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width="100%" height={height}>
      <polyline fill="none" stroke="#a855f7" strokeWidth="2" points={points} />
    </svg>
  );
}

function StoreOverview() {
  const { isMasterAdmin } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [prevMetrics, setPrevMetrics] = useState(null);
  const [error, setError] = useState("");
  const [awaitingStoreSelection, setAwaitingStoreSelection] = useState(false);

  const [system, setSystem] = useState({
    apiOnline: false,
    billingActive: false,
    alertsOpen: 0,
    devicesOnline: 0,
  });

  const [revenueTrend, setRevenueTrend] = useState([]);
  const [trendBasis, setTrendBasis] = useState("none");
  const [storeComparison, setStoreComparison] = useState([]);
  const [comparisonBasis, setComparisonBasis] = useState("none");
  const [topMovers, setTopMovers] = useState([]);
  const [deadStock, setDeadStock] = useState([]);
  const [stockRisks, setStockRisks] = useState({
    low_stock_products: 0,
    out_of_stock_products: 0,
    high_return_rate_products: 0,
    never_scanned_7d_products: 0,
    low_stock_units: 0,
    out_of_stock_demand_units: 0,
    high_return_sold_units: 0,
    never_scanned_units: 0,
    at_risk_units: 0,
  });
  const [riskItems, setRiskItems] = useState([]);
  const [brandRisks, setBrandRisks] = useState([]);

  const [executive, setExecutive] = useState({
    revenue_today: 0,
    returns_today: 0,
    processed_today: 0,
    shift_target: 0,
    shift_target_source: "auto",
  });
  const [funnel, setFunnel] = useState({
    scanned: 0,
    eligible: 0,
    sold: 0,
    returned: 0,
  });
  const [liveActivity, setLiveActivity] = useState([]);
  const [activeStoreId, setActiveStoreId] = useState(
    readActiveStoreId()
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    document.body.classList.add("glow");
    return () => document.body.classList.remove("glow");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;
    let inFlight = false;

    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const nextStoreId = readActiveStoreId();
        if (!nextStoreId) {
          setAwaitingStoreSelection(true);
          setError("");
          setMetrics(null);
          setPrevMetrics(null);
          setActiveStoreId("");
          setLiveActivity([]);
          setRevenueTrend([]);
          setStoreComparison([]);
          setSystem((prev) => ({ ...prev, apiOnline: false }));
          return;
        }
        setAwaitingStoreSelection(false);
        setActiveStoreId((prev) => (prev === nextStoreId ? prev : nextStoreId));

        const summary = await apiGet(
          `/metrics/summary?store_id=${encodeURIComponent(nextStoreId)}`
        );

        const startupResults = await Promise.allSettled([
          apiGet(`/billing/summary?store_id=${encodeURIComponent(nextStoreId)}`),
          apiGet(`/alerts?limit=20&store_id=${encodeURIComponent(nextStoreId)}`),
          apiGet(`/devices?store_id=${encodeURIComponent(nextStoreId)}`),
        ]);

        if (cancelled) return;

        const newMetrics = summary?.summary || {};
        const billingSummary =
          startupResults[0]?.status === "fulfilled"
            ? startupResults[0].value?.summary || {}
            : {};
        const alertsList =
          startupResults[1]?.status === "fulfilled" &&
          Array.isArray(startupResults[1].value?.alerts)
            ? startupResults[1].value.alerts
            : [];
        const devicesList =
          startupResults[2]?.status === "fulfilled" &&
          Array.isArray(startupResults[2].value?.devices)
            ? startupResults[2].value.devices
            : [];

        const newSystem = {
          apiOnline: true,
          billingActive:
            Number(billingSummary.expected_items_count || 0) > 0 &&
            Number(billingSummary.scanned_items_count || 0) <
              Number(billingSummary.expected_items_count || 0),
          alertsOpen: alertsList.filter((a) => a.status === "OPEN").length,
          devicesOnline: devicesList.filter(
            (d) => String(d.status || "").toLowerCase() === "online"
          ).length,
        };

        setMetrics((previous) => {
          setPrevMetrics(previous);
          return newMetrics;
        });
        setSystem(newSystem);
        setError("");

        try {
          const trend = await apiGet(
            `/metrics/revenue-trend?store_id=${encodeURIComponent(nextStoreId)}`
          );
          const values = Array.isArray(trend?.values)
            ? trend.values
            : Array.isArray(trend)
              ? trend
              : [];

          setRevenueTrend(values);
          setTrendBasis(String(trend?.basis || "none"));
        } catch {
          setRevenueTrend([]);
          setTrendBasis("none");
        }

        try {
          const stores = await apiGet("/metrics/store-comparison");
          const rows = Array.isArray(stores?.stores)
            ? stores.stores
            : Array.isArray(stores)
              ? stores
              : [];

          setStoreComparison(rows);
          setComparisonBasis(String(stores?.basis || "none"));
        } catch {
          setStoreComparison([]);
          setComparisonBasis("none");
        }

        try {
          const insights = await apiGet(
            `/stock/insights?store_id=${encodeURIComponent(nextStoreId)}&limit=5&risk_limit=120`
          );
          setTopMovers(Array.isArray(insights?.top_movers) ? insights.top_movers : []);
          setDeadStock(Array.isArray(insights?.dead_stock) ? insights.dead_stock : []);
          setStockRisks(
            insights?.risks || {
              low_stock_products: 0,
              out_of_stock_products: 0,
              high_return_rate_products: 0,
              never_scanned_7d_products: 0,
              low_stock_units: 0,
              out_of_stock_demand_units: 0,
              high_return_sold_units: 0,
              never_scanned_units: 0,
              at_risk_units: 0,
            }
          );
          setRiskItems(Array.isArray(insights?.risk_items) ? insights.risk_items : []);
          setBrandRisks(
            Array.isArray(insights?.brand_risks) ? insights.brand_risks : []
          );
        } catch {
          setTopMovers([]);
          setDeadStock([]);
          setStockRisks({
            low_stock_products: 0,
            out_of_stock_products: 0,
            high_return_rate_products: 0,
            never_scanned_7d_products: 0,
            low_stock_units: 0,
            out_of_stock_demand_units: 0,
            high_return_sold_units: 0,
            never_scanned_units: 0,
            at_risk_units: 0,
          });
          setRiskItems([]);
          setBrandRisks([]);
        }

        const extraResults = await Promise.allSettled([
          apiGet(
            `/metrics/summary?period=today&store_id=${encodeURIComponent(nextStoreId)}`
          ),
          apiGet(`/pos?store_id=${encodeURIComponent(nextStoreId)}&limit=500`),
          apiGet(
            `/pos/cart-items?store_id=${encodeURIComponent(nextStoreId)}&limit=1000&hours=24`
          ),
          apiGet("/events/recent?limit=80"),
        ]);

        if (cancelled) return;

        const todaySummary =
          extraResults[0]?.status === "fulfilled"
            ? extraResults[0].value?.summary || {}
            : {};

        const posRows =
          extraResults[1]?.status === "fulfilled" &&
          Array.isArray(extraResults[1].value?.items)
            ? extraResults[1].value.items
            : [];

        const cartRows =
          extraResults[2]?.status === "fulfilled" &&
          Array.isArray(extraResults[2].value?.items)
            ? extraResults[2].value.items
            : [];

        const eventRows =
          extraResults[3]?.status === "fulfilled" &&
          Array.isArray(extraResults[3].value?.events)
            ? extraResults[3].value.events
            : [];

        const nowMs = Date.now();
        const hours24Ms = 24 * 60 * 60 * 1000;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();

        const txns24h = posRows.filter((row) => {
          const createdAtMs = Date.parse(row?.created_at || "");
          return Number.isFinite(createdAtMs) && nowMs - createdAtMs <= hours24Ms;
        });

        const txnsToday = posRows.filter((row) => {
          const createdAtMs = Date.parse(row?.created_at || "");
          return Number.isFinite(createdAtMs) && createdAtMs >= todayStartMs;
        });

        const sold24h = txns24h.reduce((sum, row) => {
          if (isReturnTransaction(row)) return sum;
          return sum + Math.max(0, toNumber(row?.total_items));
        }, 0);

        const returned24h = txns24h.reduce((sum, row) => {
          if (!isReturnTransaction(row)) return sum;
          const qty = Math.abs(toNumber(row?.total_items));
          return sum + (qty > 0 ? qty : 1);
        }, 0);

        const soldToday = txnsToday.reduce((sum, row) => {
          if (isReturnTransaction(row)) return sum;
          return sum + Math.max(0, toNumber(row?.total_items));
        }, 0);

        const returnedToday = txnsToday.reduce((sum, row) => {
          if (!isReturnTransaction(row)) return sum;
          const qty = Math.abs(toNumber(row?.total_items));
          return sum + (qty > 0 ? qty : 1);
        }, 0);

        const scanned24h = Math.max(
          cartRows.length,
          toNumber(newMetrics.items_scanned_24h)
        );

        const eligible24h = Math.min(
          scanned24h,
          cartRows.length
            ? cartRows.filter((item) => !item?.sold_before).length
            : scanned24h
        );

        const processedToday = Math.max(
          scanned24h,
          soldToday + returnedToday,
          Math.max(0, toNumber(todaySummary.total_items_sold))
        );
        const expectedCount = Math.max(
          0,
          toNumber(billingSummary.expected_items_count)
        );
        const shiftTarget =
          expectedCount > 0
            ? expectedCount
            : Math.max(50, Math.ceil(Math.max(processedToday, 20) * 1.25));
        const shiftTargetSource = expectedCount > 0 ? "billing" : "auto";

        setExecutive({
          revenue_today: toNumber(todaySummary.total_sales_amount),
          returns_today: returnedToday,
          processed_today: processedToday,
          shift_target: shiftTarget,
          shift_target_source: shiftTargetSource,
        });

        setFunnel({
          scanned: scanned24h,
          eligible: eligible24h,
          sold: sold24h,
          returned: returned24h,
        });

        const recentEvents = eventRows
          .filter((evt) => {
            const storeId =
              evt?.data?.store_id ||
              evt?.data?.storeId ||
              evt?.data?.store ||
              evt?.data?.source_store_id;
            return !storeId || String(storeId) === nextStoreId;
          })
          .slice(-12)
          .reverse()
          .map((evt, idx) => ({
            id: `${evt?.ts || idx}-${evt?.event || "event"}-${idx}`,
            eventType: String(evt?.event || "event"),
            ts: evt?.ts || null,
            message: buildActivityMessage(evt),
          }));

        if (recentEvents.length > 0) {
          setLiveActivity(recentEvents);
        } else {
          const fallback = txns24h.slice(0, 8).map((txn, idx) => {
            const isReturn = isReturnTransaction(txn);
            const qty = Math.abs(toNumber(txn?.total_items));
            return {
              id: `txn-${txn?.id || idx}`,
              eventType: isReturn ? "POS_RETURN" : "POS_SALE",
              ts: txn?.created_at || null,
              message: isReturn
                ? `POS return recorded (${qty || 1} item${qty === 1 ? "" : "s"})`
                : `POS sale recorded (${qty || 1} item${qty === 1 ? "" : "s"})`,
            };
          });
          setLiveActivity(fallback);
        }
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (!cancelled) {
          setAwaitingStoreSelection(false);
          const status = Number(err?.status || 0);
          if (status === 401) {
            setError("Session expired. Please log in again.");
          } else {
            setError(err?.message || "Failed to load metrics");
          }
          setSystem((prev) => ({ ...prev, apiOnline: false }));
        }
      } finally {
        inFlight = false;
      }
    }

    function onStoreChanged() {
      load();
    }

    load();
    intervalId = setInterval(load, 10000);
    window.addEventListener("xandora_store_changed", onStoreChanged);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("xandora_store_changed", onStoreChanged);
    };
  }, []);

  if (!metrics && awaitingStoreSelection) {
    return (
      <div className="rounded border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
        {isMasterAdmin
          ? "Select a customer account from Account Switch (top-right) to load store data."
          : "No store is assigned to this account yet. Ask your admin to assign a store."}
      </div>
    );
  }

  if (!metrics && error) {
    return (
      <div className="space-y-2">
        <div className="text-red-500">{error}</div>
        <div className="text-white/40">Retrying...</div>
      </div>
    );
  }
  if (!metrics) return <div className="text-white/40">Loading...</div>;

  function trendArrow(current, previous) {
    if (previous == null) return null;
    if (Number(current || 0) > Number(previous || 0)) return "^";
    if (Number(current || 0) < Number(previous || 0)) return "v";
    return null;
  }

  const healthScore = Math.max(
    0,
    100 -
      system.alertsOpen * 10 -
      (system.apiOnline ? 0 : 30) -
      (system.billingActive ? 5 : 0)
  );

  const funnelMax = Math.max(
    funnel.scanned,
    funnel.eligible,
    funnel.sold,
    funnel.returned,
    1
  );
  const lowStockUnits = toNumber(stockRisks.low_stock_units);
  const outOfStockDemandUnits = toNumber(stockRisks.out_of_stock_demand_units);
  const highReturnSoldUnits = toNumber(stockRisks.high_return_sold_units);
  const dormantUnits = toNumber(stockRisks.never_scanned_units);
  const refillNowUnits = outOfStockDemandUnits + lowStockUnits;
  const brandRiskRows = normalizeBrandRiskRows(
    brandRisks.length ? brandRisks : buildBrandRiskRows(riskItems)
  );
  const lowStockBrands = topBrandNamesByMetric(brandRiskRows, "low_stock_units");
  const outOfStockBrands = topBrandNamesByMetric(
    brandRiskRows,
    "out_of_stock_demand_units"
  );
  const highReturnBrands = topBrandNamesByMetric(
    brandRiskRows,
    "high_return_sold_units"
  );
  const dormantByBrand = dormantBrandBreakdown(brandRiskRows);
  const oldestNoScanDays = dormantByBrand.reduce(
    (max, row) => Math.max(max, toNumber(row?.max_days)),
    0
  );
  const topBrandsToCheck = priorityBrandBreakdown(brandRiskRows, 3);

  const shiftTarget = Math.max(1, toNumber(executive.shift_target || 0));
  const shiftProcessed = toNumber(executive.processed_today || 0);
  const shiftProgressPct = Math.min(
    100,
    Math.round((shiftProcessed / shiftTarget) * 100)
  );
  const shiftTargetLabel =
    executive.shift_target_source === "billing" ? "Billing target" : "Auto target";

  const riskSnapshot =
    `Now: ${refillNowUnits} refill units, ` +
    `${dormantUnits} no-scan units, ` +
    `${highReturnSoldUnits} return-risk units.`;

  const firstActions = [];
  if (outOfStockDemandUnits > 0) {
    firstActions.push(
      `Refill ${outOfStockDemandUnits} blocked units in ${outOfStockBrands.length ? outOfStockBrands.join(", ") : "priority brands"}.`
    );
  }
  if (lowStockUnits > 0) {
    firstActions.push(
      `Top up ${lowStockUnits} low-stock units in ${lowStockBrands.length ? lowStockBrands.join(", ") : "check low-stock brands"}.`
    );
  }
  if (dormantByBrand.length > 0) {
    const firstDormant = dormantByBrand[0];
    firstActions.push(
      `Check ${firstDormant.brand}: ${firstDormant.units} units not scanned for ${firstDormant.max_days} days.`
    );
  }
  if (highReturnSoldUnits > 0) {
    firstActions.push(
      `Review returns: ${highReturnSoldUnits} sold units at high return risk in ${highReturnBrands.length ? highReturnBrands.join(", ") : "high-return brands"}.`
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {/* ── PAGE HEADER ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Control Center</h1>
          <div className="text-xs opacity-50 mt-0.5">
            {activeStoreId ? `${activeStoreId} · ` : ""}
            Live · updated {formatClockTime(lastUpdatedAt)}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill
            label="API"
            ok={system.apiOnline}
            okText="Online"
            offText="Offline"
          />
          <StatusPill
            label={`${system.devicesOnline} device${system.devicesOnline === 1 ? "" : "s"}`}
            ok={system.devicesOnline > 0}
            okText="online"
            offText="offline"
          />
          {system.alertsOpen > 0 && (
            <span className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2.5 py-0.5 text-[11px] text-rose-300">
              {system.alertsOpen} open alert{system.alertsOpen === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* ── HERO ROW: the 3 things every manager checks first ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Shift progress — biggest card */}
        <div className="relative overflow-hidden rounded-xl border glass glow-border p-5 sm:col-span-1">
          <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-cyan-500/15 blur-2xl pointer-events-none" />
          <div className="text-xs opacity-60 mb-3">Shift Progress</div>
          <div className="flex items-end justify-between mb-2">
            <span className="text-3xl font-bold">{shiftProgressPct}%</span>
            <span className="text-xs opacity-50 pb-1">{shiftTargetLabel}</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-cyan-400/80 transition-all duration-700"
              style={{ width: `${shiftProgressPct}%` }}
            />
          </div>
          <div className="text-[11px] opacity-55 mt-2">
            {shiftProcessed} of {shiftTarget} units processed today
          </div>
        </div>

        <HeroKpi
          title="Revenue Today"
          value={formatLkr(executive.revenue_today)}
          hint="Net POS amount for current day"
        />
        <HeroKpi
          title="Returns Today"
          value={executive.returns_today}
          hint="Units processed through return flow"
        />
      </div>

      {/* ── ACTION ROW: what does the team need to do right now ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Priority Actions">
          {firstActions.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5 text-xs text-emerald-300">
              All clear — no urgent actions right now.
            </div>
          ) : (
            <ol className="space-y-2">
              {firstActions.slice(0, 3).map((step, idx) => (
                <li
                  key={`first-action-${idx}`}
                  className="flex items-start gap-2.5 text-xs"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-[10px] font-semibold text-purple-300">
                    {idx + 1}
                  </span>
                  <span className="leading-5">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Top Brands to Check">
          {topBrandsToCheck.length === 0 ? (
            <div className="text-xs opacity-50">No priority brands right now.</div>
          ) : (
            <div className="space-y-2">
              {topBrandsToCheck.map((row, idx) => (
                <div
                  key={`priority-brand-${row.brand}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-semibold text-amber-300">
                      {idx + 1}
                    </span>
                    <span className="font-medium truncate">{row.brand}</span>
                  </div>
                  <span className="opacity-70 ml-2 shrink-0">{row.units} risk units</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── LIVE ACTIVITY + QUICK KPIs ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Live Activity" className="xl:col-span-1">
          {liveActivity.length === 0 ? (
            <div className="text-xs opacity-40">No recent activity yet</div>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
              {liveActivity.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/10 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium truncate">{item.message}</div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${activityToneClass(item.eventType)}`}
                    >
                      {formatEventType(item.eventType)}
                    </span>
                  </div>
                  <div className="text-[11px] opacity-55 mt-0.5">
                    {formatActivityTime(item.ts)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="xl:col-span-2 grid grid-cols-2 gap-4 content-start">
          <Kpi
            title="Total Sales"
            value={`LKR ${metrics.total_sales_amount || 0}`}
            trend={trendArrow(metrics.total_sales_amount, prevMetrics?.total_sales_amount)}
          />
          <Kpi
            title="Items Sold"
            value={metrics.total_items_sold || 0}
            trend={trendArrow(metrics.total_items_sold, prevMetrics?.total_items_sold)}
          />
          <Kpi
            title="Scan Velocity (24h)"
            value={metrics.items_scanned_24h || 0}
            trend={trendArrow(metrics.items_scanned_24h, prevMetrics?.items_scanned_24h)}
          />
          <Kpi
            title="Billing Active"
            value={system.billingActive ? "Active" : "Idle"}
            tone={system.billingActive ? "emerald" : "neutral"}
          />
        </div>
      </div>

      {/* ── DIVIDER: analytics below the fold ── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-white/8" />
        <span className="text-[11px] opacity-40 uppercase tracking-widest">Analytics</span>
        <div className="h-px flex-1 bg-white/8" />
      </div>

      {/* ── RFID FUNNEL + SYSTEM HEALTH ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="RFID Journey Funnel (24h)" className="xl:col-span-2">
          <FunnelStep label="Scanned Tags" value={funnel.scanned} max={funnelMax} tone="cyan" />
          <FunnelStep label="Bill-Ready (Unsold)" value={funnel.eligible} max={funnelMax} tone="purple" />
          <FunnelStep label="Sold" value={funnel.sold} max={funnelMax} tone="emerald" />
          <FunnelStep label="Returned" value={funnel.returned} max={funnelMax} tone="amber" />
          <div className="text-[11px] opacity-50">
            Scanned → bill-ready → POS sales → POS returns
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="System Health">
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 transition-all duration-500"
                style={{ width: `${healthScore}%` }}
              />
            </div>
            <div className="text-xs opacity-60 mt-1.5">Score: {healthScore} / 100</div>
          </Card>

          <Card title="Revenue Trend (7d)">
            <MiniLineChart data={revenueTrend} />
            {trendBasis !== "none" && (
              <div className="text-[11px] opacity-45 mt-1">
                {trendBasis === "sales" ? "Based on POS sales" : "Based on scan activity"}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── STOCK INTELLIGENCE ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Dead Stock & Top Movers">
          <div className="rounded-xl border border-rose-500/35 bg-gradient-to-r from-rose-500/15 via-amber-500/8 to-transparent p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-rose-200">Dead Stock</div>
                <div className="text-[11px] text-rose-100/70">
                  In stock but no sell-through
                </div>
              </div>
              <span className="rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-200">
                {deadStock.length}
              </span>
            </div>
            {deadStock.length === 0 ? (
              <div className="text-xs text-rose-100/60">No dead stock right now.</div>
            ) : (
              <div className="space-y-1.5">
                {deadStock.slice(0, 3).map((item) => (
                  <div
                    key={`dead-${item.group_key || `${item.sku || ""}-${item.product_name || ""}`}`}
                    className="rounded-lg border border-rose-500/25 bg-black/30 px-3 py-2"
                  >
                    <div className="text-xs font-medium truncate text-rose-100">
                      {item.product_name || item.sku || "Unmapped"}
                    </div>
                    <div className="text-[11px] text-rose-100/65">
                      {item.brand || "-"} · {item.in_stock_count || 0} stuck in stock ·{" "}
                      last scan {item.last_scan_at ? formatActivityTime(item.last_scan_at) : "never"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold mb-2 opacity-80">Top Movers</div>
            {topMovers.length === 0 ? (
              <div className="text-xs opacity-40">No top movers yet</div>
            ) : (
              <div className="space-y-1.5">
                {topMovers.map((item) => (
                  <div
                    key={item.group_key || `${item.sku || ""}-${item.product_name || ""}`}
                    className="rounded-lg border border-white/10 px-3 py-2"
                  >
                    <div className="text-xs font-medium truncate">
                      {item.product_name || item.sku || "Unmapped item"}
                    </div>
                    <div className="text-[11px] opacity-55">
                      {item.brand || "-"} · Sold {item.sold_count || 0} · In stock {item.in_stock_count || 0} · Return rate {Number(item.return_rate_pct || 0).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="No-Scan Brand Watchlist">
          <div className="text-[11px] opacity-60 leading-5">
            Brands with units not scanned in the last 7 days. Check placement, tag readability, and floor visibility.
          </div>

          <div className="grid grid-cols-3 gap-2">
            <SimpleStatMini
              label="No-Scan Units"
              value={`${dormantUnits}`}
              hint="Not scanned in 7d"
            />
            <SimpleStatMini
              label="Brands Affected"
              value={`${dormantByBrand.length}`}
              hint="Need checking"
            />
            <SimpleStatMini
              label="Longest Gap"
              value={`${oldestNoScanDays}d`}
              hint="Max days without scan"
            />
          </div>

          {dormantByBrand.length > 0 && (
            <div className="space-y-1.5">
              {dormantByBrand.map((row) => (
                <div
                  key={`dormant-brand-${row.brand}`}
                  className="flex items-center justify-between text-xs border border-white/10 rounded px-2.5 py-1.5"
                >
                  <span className="font-medium truncate pr-2">{row.brand}</span>
                  <span className="opacity-65 shrink-0">{row.units} units · {row.max_days}d</span>
                </div>
              ))}
            </div>
          )}
          {dormantByBrand.length === 0 && (
            <div className="text-xs opacity-45">No dormant brands right now.</div>
          )}
        </Card>
      </div>

      {/* ── STORE COMPARISON ── */}
      {storeComparison.length > 0 && (
        <Card title="Store Comparison">
          <div className="flex flex-wrap gap-3">
            {storeComparison.map((s) => (
              <div
                key={s.store_id}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs min-w-[120px]"
              >
                <div className="font-medium opacity-80">{s.store_id}</div>
                <div className="opacity-55 mt-0.5">
                  {comparisonBasis === "sales"
                    ? `LKR ${Number(s.value || 0).toLocaleString()}`
                    : `${Number(s.value || 0)} scans`}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* =========================
   COMPONENTS
========================= */
function HeroKpi({ title, value, hint }) {
  return (
    <div className="relative overflow-hidden rounded-xl border glass glow-border p-4">
      <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-purple-500/20 blur-2xl pointer-events-none" />
      <div className="text-xs opacity-70 mb-1">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-[11px] opacity-60 mt-1">{hint}</div>
    </div>
  );
}

function Kpi({ title, value, trend, tone = "neutral" }) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
      ? "text-rose-300"
      : "";
  return (
    <div className="p-4 rounded-xl border glass glow-border">
      <div className="text-xs opacity-60 mb-1">{title}</div>
      <div className={`text-lg font-semibold flex items-center gap-2 ${valueClass}`}>
        {value}
        {trend && <span className="text-purple-400 text-sm">{trend}</span>}
      </div>
    </div>
  );
}

function StatusPill({ label, ok, okText, offText }) {
  return (
    <span
      className={[
        "rounded-full border px-2.5 py-0.5 text-[11px]",
        ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-white/20 bg-white/5 text-white/45",
      ].join(" ")}
    >
      {label} {ok ? okText : offText}
    </span>
  );
}

function Card({ title, children, className = "" }) {
  return (
    <div className={`glass rounded-xl border p-5 space-y-3 glow-border ${className}`}>
      <div className="text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div className="text-xs opacity-70">
      {label}: {value}
    </div>
  );
}

function FunnelStep({ label, value, max, tone = "purple" }) {
  const pct = Math.max(
    0,
    Math.min(100, (toNumber(value) / Math.max(toNumber(max), 1)) * 100)
  );

  const fillClass =
    tone === "cyan"
      ? "bg-cyan-400/80"
      : tone === "emerald"
      ? "bg-emerald-400/80"
      : tone === "amber"
      ? "bg-amber-400/80"
      : "bg-purple-400/80";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="opacity-80">{label}</span>
        <span className="font-semibold">{toNumber(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full transition-all duration-500 ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SimpleStatMini({ label, value = "-", hint = "" }) {
  return (
    <div className="rounded-lg border border-white/15 px-3 py-2">
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {hint ? <div className="text-[10px] opacity-75 mt-0.5">{hint}</div> : null}
    </div>
  );
}

export default function Overview() {
  const { isMasterAdmin } = useAuth();
  const [companyView, setCompanyView] = useState(() =>
    normalizeCompanyView(localStorage.getItem("xandora_company_view") || "")
  );

  useEffect(() => {
    function syncCompanyView() {
      const normalized = normalizeCompanyView(
        localStorage.getItem("xandora_company_view") || ""
      );
      setCompanyView((prev) => (prev === normalized ? prev : normalized));
    }

    window.addEventListener("storage", syncCompanyView);
    window.addEventListener("xandora_company_view_changed", syncCompanyView);
    return () => {
      window.removeEventListener("storage", syncCompanyView);
      window.removeEventListener("xandora_company_view_changed", syncCompanyView);
    };
  }, []);

  if (isMasterAdmin && !companyView) {
    return <MasterAdminOverview />;
  }

  return <StoreOverview />;
}
