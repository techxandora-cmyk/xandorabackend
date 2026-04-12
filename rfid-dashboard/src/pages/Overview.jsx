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
  return String(localStorage.getItem("zyro_store_id") || "")
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
    window.addEventListener("zyro_store_changed", onStoreChanged);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("zyro_store_changed", onStoreChanged);
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
    <div className="space-y-8">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold">Xandora Control Center</h1>
        <div className="text-xs opacity-60 mt-1">
          Real-time RFID orchestration for faster billing, live stock visibility, and safer returns.
        </div>
      </div>

      <Card title="Risk Snapshot">
        <div className="text-sm">{riskSnapshot}</div>
        <div className="text-[11px] opacity-65">
          Updated every 10s for {activeStoreId}. Last updated {formatClockTime(lastUpdatedAt)}.
        </div>
        <div className="text-[11px] opacity-65">Data window: 24h sales/scans, 7d no-scan.</div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Shift Progress">
          <div className="flex items-center justify-between text-xs">
            <span className="opacity-80">{shiftTargetLabel}</span>
            <span className="font-semibold">{shiftProgressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-cyan-400/80 transition-all duration-500"
              style={{ width: `${shiftProgressPct}%` }}
            />
          </div>
          <div className="text-[11px] opacity-70">
            {shiftProcessed} / {shiftTarget} units processed
          </div>
        </Card>

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Top 3 Brands To Check">
          {topBrandsToCheck.length === 0 ? (
            <div className="text-xs opacity-50">No priority brands right now.</div>
          ) : (
            <div className="space-y-1.5">
              {topBrandsToCheck.map((row) => (
                <div
                  key={`priority-brand-${row.brand}`}
                  className="flex items-center justify-between text-xs border border-white/10 rounded px-2 py-1.5"
                >
                  <span className="font-medium truncate pr-2">{row.brand}</span>
                  <span className="opacity-80">{row.units} risk units</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Priority Actions">
          {firstActions.length === 0 ? (
            <div className="text-xs opacity-50">No urgent actions. Team is clear.</div>
          ) : (
            <ol className="list-decimal list-inside space-y-1 text-xs">
              {firstActions.slice(0, 3).map((step, idx) => (
                <li key={`first-action-${idx}`}>{step}</li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* JOURNEY + LIVE TRACKER */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="RFID Journey Funnel (24h)" className="xl:col-span-2">
          <FunnelStep
            label="Scanned Tags"
            value={funnel.scanned}
            max={funnelMax}
            tone="cyan"
          />
          <FunnelStep
            label="Bill-Ready (Unsold)"
            value={funnel.eligible}
            max={funnelMax}
            tone="purple"
          />
          <FunnelStep
            label="Sold"
            value={funnel.sold}
            max={funnelMax}
            tone="emerald"
          />
          <FunnelStep
            label="Returned"
            value={funnel.returned}
            max={funnelMax}
            tone="amber"
          />
          <div className="text-[11px] opacity-60">
            Flow: scanned tags -&gt; bill-ready units -&gt; POS sales -&gt; POS returns.
          </div>
        </Card>

        <Card title="Live Activity Tracker">
          {liveActivity.length === 0 ? (
            <div className="text-xs opacity-40">No recent activity yet</div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
              {liveActivity.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/10 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium truncate">{item.message}</div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${activityToneClass(item.eventType)}`}
                    >
                      {formatEventType(item.eventType)}
                    </span>
                  </div>
                  <div className="text-[11px] opacity-60 mt-1">
                    {formatActivityTime(item.ts)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          title="Total Sales"
          value={`LKR ${metrics.total_sales_amount || 0}`}
          trend={trendArrow(
            metrics.total_sales_amount,
            prevMetrics?.total_sales_amount
          )}
        />
        <Kpi
          title="Items Sold"
          value={metrics.total_items_sold || 0}
          trend={trendArrow(
            metrics.total_items_sold,
            prevMetrics?.total_items_sold
          )}
        />
        <Kpi title="Active Billing" value={system.billingActive ? "YES" : "NO"} />
        <Kpi
          title="Scan Velocity (24h)"
          value={metrics.items_scanned_24h || 0}
          trend={trendArrow(
            metrics.items_scanned_24h,
            prevMetrics?.items_scanned_24h
          )}
        />
      </div>

      {/* SECOND ROW */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Store Snapshot">
          <Line label="Devices Online" value={system.devicesOnline} />
          <Line label="Open Alerts" value={system.alertsOpen} />
          <Line label="API Status" value={system.apiOnline ? "ONLINE" : "OFFLINE"} />
        </Card>

        <Card title="System Health">
          <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-500"
              style={{ width: `${healthScore}%` }}
            />
          </div>
          <div className="text-xs opacity-70 mt-2">
            Overall Health Score: {healthScore}%
          </div>
        </Card>

        <Card title="Revenue Trend (7d)">
          <MiniLineChart data={revenueTrend} />
          {trendBasis !== "none" && (
            <div className="text-[11px] opacity-50">
              Source: {trendBasis === "sales" ? "POS Sales" : "Scan Activity"}
            </div>
          )}
        </Card>

        <Card title="Store Comparison">
          {storeComparison.length === 0 ? (
            <div className="text-xs opacity-40">No comparison data</div>
          ) : (
            storeComparison.map((s) => (
              <div key={s.store_id} className="text-xs">
                {s.store_id} -{" "}
                {comparisonBasis === "sales"
                  ? `LKR ${Number(s.value || 0)}`
                  : `${Number(s.value || 0)} scans`}
              </div>
            ))
          )}
        </Card>
      </div>

      {/* THIRD ROW */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Top Movers & Dead Stock">
          <div className="rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-500/20 via-amber-500/10 to-transparent p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-rose-200">Dead Stock Watch</div>
                <div className="text-[11px] text-rose-100/80">
                  Products with inventory but no sell-through.
                </div>
              </div>
              <span className="rounded-full border border-rose-400/50 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-200">
                {deadStock.length}
              </span>
            </div>

            {deadStock.length === 0 ? (
              <div className="rounded-lg border border-rose-500/20 bg-black/25 px-3 py-2 text-xs text-rose-100/70">
                No dead stock right now.
              </div>
            ) : (
              <div className="space-y-2">
                {deadStock.slice(0, 4).map((item) => (
                  <div
                    key={`dead-${item.group_key || `${item.sku || ""}-${item.product_name || ""}`}`}
                    className="rounded-lg border border-rose-500/30 bg-black/35 px-3 py-2"
                  >
                    <div className="text-xs font-medium truncate text-rose-100">
                      {item.product_name || item.sku || "Unmapped"}
                    </div>
                    <div className="text-[11px] text-rose-100/75">
                      {item.brand || "-"} | {item.in_stock_count || 0} stuck in stock
                    </div>
                    <div className="text-[11px] text-amber-200/80">
                      Last scan:{" "}
                      {item.last_scan_at ? formatActivityTime(item.last_scan_at) : "No scan detected"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-1">
            <div className="text-xs font-semibold mb-2 opacity-90">Top Movers</div>
            {topMovers.length === 0 ? (
              <div className="text-xs opacity-40">No top movers yet</div>
            ) : (
              <div className="space-y-2">
                {topMovers.map((item) => (
                  <div
                    key={item.group_key || `${item.sku || ""}-${item.product_name || ""}`}
                    className="rounded-lg border border-white/10 px-3 py-2"
                  >
                    <div className="text-xs font-medium truncate">
                      {item.product_name || item.sku || "Unmapped item"}
                    </div>
                    <div className="text-[11px] opacity-60">
                      {item.brand || "-"} | Sold {item.sold_count || 0} | In stock{" "}
                      {item.in_stock_count || 0}
                    </div>
                    <div className="text-[11px] text-cyan-300">
                      Return rate {Number(item.return_rate_pct || 0).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="No-Scan Brand Watchlist">
          <div className="rounded-lg border border-white/15 bg-black/30 px-3 py-2">
            <div className="text-xs font-medium">Store team checklist</div>
            <div className="text-[11px] opacity-70 mt-1">
              These brands have units not scanned recently. Check placement, tag readability, and floor visibility.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SimpleStatMini
              label="No-Scan Units"
              value={`${dormantUnits}`}
              hint="Total units not scanned in 7d"
            />
            <SimpleStatMini
              label="Brands Affected"
              value={`${dormantByBrand.length}`}
              hint="How many brands need checking"
            />
            <SimpleStatMini
              label="Oldest No-Scan"
              value={`${oldestNoScanDays}d`}
              hint="Longest scan gap in store"
            />
          </div>

          <div className="rounded-lg border border-white/10 px-3 py-2">
            <div className="text-[11px] opacity-80 mb-2">Brands to check now</div>
            {dormantByBrand.length === 0 ? (
              <div className="text-xs opacity-50">No dormant brands right now.</div>
            ) : (
              <div className="space-y-1.5">
                {dormantByBrand.map((row) => (
                  <div
                    key={`dormant-brand-${row.brand}`}
                    className="flex items-center justify-between text-xs border border-white/10 rounded px-2 py-1.5"
                  >
                    <span className="font-medium truncate pr-2">{row.brand}</span>
                    <span className="opacity-80 text-right">
                      {row.units} units | {row.max_days}d no scan
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
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

function Kpi({ title, value, trend }) {
  return (
    <div className="p-4 rounded-xl border glass glow-border">
      <div className="text-xs opacity-60 mb-1">{title}</div>
      <div className="text-lg font-semibold flex items-center gap-2">
        {value}
        {trend && <span className="text-purple-400 text-sm">{trend}</span>}
      </div>
    </div>
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
    normalizeCompanyView(localStorage.getItem("zyro_company_view") || "")
  );

  useEffect(() => {
    function syncCompanyView() {
      const normalized = normalizeCompanyView(
        localStorage.getItem("zyro_company_view") || ""
      );
      setCompanyView((prev) => (prev === normalized ? prev : normalized));
    }

    window.addEventListener("storage", syncCompanyView);
    window.addEventListener("zyro_company_view_changed", syncCompanyView);
    return () => {
      window.removeEventListener("storage", syncCompanyView);
      window.removeEventListener("zyro_company_view_changed", syncCompanyView);
    };
  }, []);

  if (isMasterAdmin && !companyView) {
    return <MasterAdminOverview />;
  }

  return <StoreOverview />;
}
