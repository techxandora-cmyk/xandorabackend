import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const VIEWS = {
  dashboard: {
    kicker: "Audit command",
    title: "Monitor count readiness, live progress, and recent sessions.",
    summary:
      "Keep the supervisor view focused while handheld scans drive the count in the field.",
  },
  sessions: {
    kicker: "Count control",
    title: "Start, monitor, and close stock audit sessions cleanly.",
    summary:
      "Use expected counts when needed, then follow live progress until reconciliation is complete.",
  },
  findings: {
    kicker: "Reconciliation",
    title: "Review scanned items, discrepancies, and priority follow-up.",
    summary:
      "Bring together current reads and stock pressure so teams know what needs action next.",
  },
};

function toNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function when(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function durationLabel(seconds) {
  const total = Math.max(Number(seconds || 0), 0);
  if (!Number.isFinite(total) || total <= 0) return "0s";
  if (total < 60) return `${Math.round(total)}s`;
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function Metric({ title, value, detail, tone = "" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone || "border-white/10 bg-white/[0.03]"}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">{title}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-white/72">{detail}</div>
    </div>
  );
}

function Card({ title, subtitle, actions = null, accent = false, children }) {
  return (
    <section
      className={`rounded-[28px] border p-5 ${
        accent
          ? "border-amber-500/20 bg-[linear-gradient(180deg,rgba(20,24,38,0.92),rgba(10,14,24,0.9))]"
          : "border-white/10 bg-black/30"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm leading-6 text-white/72">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Pill({ tone, children }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${tone}`}
    >
      {children}
    </span>
  );
}

function riskTone(item) {
  if (item?.risk_out_of_stock) return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (item?.risk_high_return_rate)
    return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  if (item?.risk_low_stock) return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (item?.risk_never_scanned_7d) return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  return "border-white/15 bg-white/5 text-white/80";
}

export default function StockAudit({ view = "dashboard" }) {
  const { hasPermission, isAdmin, isMasterAdmin } = useAuth();
  const canManage =
    isAdmin || isMasterAdmin || hasPermission("dashboard.manage_stock_audit");

  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
  );
  const [expectedCount, setExpectedCount] = useState("");
  const [history, setHistory] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [progress, setProgress] = useState({
    active: false,
    found: 0,
    expected: 0,
    missing: 0,
    accuracy: 0,
    reads: 0,
    duration_seconds: 0,
    read_rate: 0,
    session: null,
  });
  const [kpis, setKpis] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsSource, setItemsSource] = useState("active_session");
  const [insights, setInsights] = useState({
    dead_stock: [],
    risks: {},
    risk_items: [],
    brand_risks: [],
  });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const timerRef = useRef(null);

  const selectedView = VIEWS[view] || VIEWS.dashboard;

  const loadStockAudit = useCallback(async () => {
    const sid = String(storeId || "").trim();
    if (!sid) {
      setError("Select a customer store before using Xandora Stock Audit.");
      setActiveSession(null);
      setHistory([]);
      setItems([]);
      setInsights({ dead_stock: [], risks: {}, risk_items: [], brand_risks: [] });
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [historyRes, activeRes, kpisRes, progressRes, itemsRes, insightsRes] =
        await Promise.all([
          apiGet(`/inventory/history?store_id=${encodeURIComponent(sid)}`),
          apiGet(`/inventory/active?store_id=${encodeURIComponent(sid)}`),
          apiGet(`/inventory/kpis?store_id=${encodeURIComponent(sid)}`),
          apiGet(`/inventory/progress?store_id=${encodeURIComponent(sid)}`),
          apiGet(`/inventory/items?store_id=${encodeURIComponent(sid)}&limit=200`),
          apiGet(`/stock/insights?store_id=${encodeURIComponent(sid)}&limit=6&risk_limit=40`),
        ]);

      setHistory(Array.isArray(historyRes?.sessions) ? historyRes.sessions : []);
      setActiveSession(activeRes?.session || null);
      setKpis(kpisRes?.kpis || null);
      setProgress({
        active: Boolean(progressRes?.active),
        found: toNum(progressRes?.found),
        expected: toNum(progressRes?.expected),
        missing: toNum(progressRes?.missing),
        accuracy: toNum(progressRes?.accuracy),
        reads: toNum(progressRes?.reads),
        duration_seconds: toNum(progressRes?.duration_seconds),
        read_rate: toNum(progressRes?.read_rate),
        session: progressRes?.session || null,
      });
      setItems(Array.isArray(itemsRes?.items) ? itemsRes.items : []);
      setItemsSource(String(itemsRes?.source || "active_session"));
      setInsights({
        dead_stock: Array.isArray(insightsRes?.dead_stock) ? insightsRes.dead_stock : [],
        risks: insightsRes?.risks || {},
        risk_items: Array.isArray(insightsRes?.risk_items) ? insightsRes.risk_items : [],
        brand_risks: Array.isArray(insightsRes?.brand_risks) ? insightsRes.brand_risks : [],
      });
    } catch (err) {
      console.error("[StockAudit] load failed:", err);
      setError(err?.error || err?.message || "Failed to load Xandora Stock Audit");
      setActiveSession(null);
      setHistory([]);
      setItems([]);
      setInsights({ dead_stock: [], risks: {}, risk_items: [], brand_risks: [] });
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadLiveProgress = useCallback(async () => {
    const sid = String(storeId || "").trim();
    if (!sid) return;

    try {
      const [progressRes, itemsRes] = await Promise.all([
        apiGet(`/inventory/progress?store_id=${encodeURIComponent(sid)}`),
        apiGet(`/inventory/items?store_id=${encodeURIComponent(sid)}&limit=200`),
      ]);
      setProgress({
        active: Boolean(progressRes?.active),
        found: toNum(progressRes?.found),
        expected: toNum(progressRes?.expected),
        missing: toNum(progressRes?.missing),
        accuracy: toNum(progressRes?.accuracy),
        reads: toNum(progressRes?.reads),
        duration_seconds: toNum(progressRes?.duration_seconds),
        read_rate: toNum(progressRes?.read_rate),
        session: progressRes?.session || null,
      });
      setItems(Array.isArray(itemsRes?.items) ? itemsRes.items : []);
      setItemsSource(String(itemsRes?.source || "active_session"));
    } catch (err) {
      console.warn("[StockAudit] live progress failed:", err?.message || err);
    }
  }, [storeId]);

  useEffect(() => {
    loadStockAudit();
  }, [loadStockAudit]);

  useEffect(() => {
    function onStoreChanged() {
      setStoreId(localStorage.getItem("xandora_store_id") || "");
    }
    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
  }, []);

  useEffect(() => {
    if (activeSession?.status !== "ACTIVE") {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return undefined;
    }
    timerRef.current = setInterval(() => loadLiveProgress(), 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [activeSession?.status, loadLiveProgress]);

  async function startSession() {
    if (!canManage) return;
    setActionLoading("start");
    setError("");
    setMessage("");
    try {
      await apiPost("/inventory/start", {
        store_id: storeId,
        total_expected: toNum(expectedCount),
      });
      setMessage("Stock audit session started.");
      await loadStockAudit();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to start stock audit session");
    } finally {
      setActionLoading("");
    }
  }

  async function endSession() {
    if (!canManage) return;
    setActionLoading("end");
    setError("");
    setMessage("");
    try {
      await apiPost("/inventory/end", { store_id: storeId });
      setMessage("Stock audit session closed.");
      await loadStockAudit();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to close stock audit session");
    } finally {
      setActionLoading("");
    }
  }

  const riskSummary = insights.risks || {};
  const riskItems = Array.isArray(insights.risk_items) ? insights.risk_items : [];
  const brandRisks = Array.isArray(insights.brand_risks) ? insights.brand_risks : [];
  const recentHistory = history.slice(0, 8);
  const liveSession = progress.session || activeSession || null;
  const foundCount = progress.active ? progress.found : toNum(activeSession?.total_found);
  const expected = progress.active ? progress.expected : toNum(activeSession?.total_expected);
  const missingCount = progress.active ? progress.missing : toNum(activeSession?.total_missing);
  const accuracy = progress.active
    ? progress.accuracy
    : toNum(activeSession?.accuracy_percent);
  const sessionDuration = progress.active
    ? progress.duration_seconds
    : toNum(activeSession?.duration_seconds);
  const sessionReadRate = progress.active
    ? progress.read_rate
    : toNum(activeSession?.read_rate);
  const auditStateTone =
    activeSession?.status === "ACTIVE"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/5 text-white/75";
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <section className="laundry-hero rounded-[32px] border border-amber-500/18 px-6 py-6 shadow-[0_26px_64px_rgba(3,10,20,0.28)]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                Xandora Stock Audit
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                Count control
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                Discrepancy visibility
              </span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              Audit-ready stock visibility without the noise.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/78">
              Handheld teams can run the count in the field while supervisors keep a clean view of
              sessions, discrepancies, and scanned coverage inside Xandora.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Metric title="Sessions total" value={toNum(kpis?.sessions_total).toLocaleString()} detail="Completed and live audit sessions." />
              <Metric title="Avg accuracy" value={`${toNum(kpis?.avg_accuracy_percent).toFixed(1)}%`} detail="Average count accuracy across sessions." />
              <Metric title="Unique EPCs" value={toNum(kpis?.unique_epcs_total).toLocaleString()} detail="Distinct tags seen by the audit engine." />
              <Metric title="At risk units" value={toNum(riskSummary?.at_risk_units).toLocaleString()} detail="Units requiring follow-up or reconciliation." tone={toNum(riskSummary?.at_risk_units) ? "border-amber-500/25 bg-amber-500/6" : ""} />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/12 bg-black/20 p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Store scope</div>
            <div className="mt-2 text-lg font-semibold text-white">{storeId || "No store selected"}</div>
            <div className="mt-3">
              <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${auditStateTone}`}>
                {activeSession?.status === "ACTIVE" ? "Live session" : "Ready"}
              </span>
            </div>
            <div className="mt-3 text-xs text-white/65">
              Session ID: {liveSession?.session_id || liveSession?.id || "Waiting to start"}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric title="Found" value={foundCount.toLocaleString()} detail="Distinct tags found in the current audit." />
              <Metric title="Reads" value={toNum(progress.reads).toLocaleString()} detail="Total scan reads captured." />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Metric title="Missing" value={missingCount.toLocaleString()} detail="Expected items still not found in this session." />
              <Metric title="Session time" value={durationLabel(sessionDuration)} detail={`Read rate ${sessionReadRate.toFixed(2)}/s`} />
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Expected / accuracy</div>
              <div className="mt-2 text-lg font-semibold text-white">
                {expected.toLocaleString()} expected | {accuracy.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-white/60">
                Missing {missingCount.toLocaleString()} | Session duration {durationLabel(sessionDuration)}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#F59E0B_0%,#16F9F3_100%)] transition-all" style={{ width: `${Math.max(0, Math.min(accuracy, 100))}%` }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      {message ? <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div> : null}

      <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-amber-200/85">{selectedView.kicker}</div>
        <div className="mt-1 text-lg font-semibold text-white">{selectedView.title}</div>
        <div className="mt-1 text-sm text-white/72">{selectedView.summary}</div>
      </div>

      {view === "dashboard" ? (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(340px,1.05fr)]">
            <Card title="Priority Findings" subtitle="The items most likely to need recount, replenishment, or follow-up.">
              {!riskItems.length ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-200">
                  No immediate stock audit risks for the selected store.
                </div>
              ) : (
                <div className="space-y-3">
                  {riskItems.slice(0, 6).map((item) => (
                    <div key={item.group_key || `${item.sku}-${item.barcode}-${item.product_name}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{item.product_name || item.sku || item.barcode || "Unnamed item"}</div>
                          <div className="mt-1 text-xs text-white/55">{[item.brand, item.category, item.size_label].filter(Boolean).join(" | ") || "Audit finding"}</div>
                        </div>
                        <Pill tone={riskTone(item)}>
                          {item.risk_out_of_stock ? "Out of stock" : item.risk_high_return_rate ? "Return pressure" : item.risk_low_stock ? "Low stock" : "No scan"}
                        </Pill>
                      </div>
                      <div className="mt-3 text-sm text-white/70">
                        In stock: {toNum(item.in_stock_count).toLocaleString()} | Sold: {toNum(item.sold_count).toLocaleString()} | Last scan age: {toNum(item.days_since_scan).toLocaleString()} days
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recent Sessions" subtitle="A quick view of the latest count cycles and accuracy.">
              {!recentHistory.length ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
                  No stock audit history yet for this store.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentHistory.map((session) => (
                    <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div>
                        <div className="text-sm font-semibold text-white">{session.session_id || `Session #${session.id}`}</div>
                        <div className="mt-1 text-xs text-white/55">Started {when(session.started_at)}</div>
                        <div className="mt-1 text-xs text-white/45">
                          Duration {durationLabel(session.duration_seconds)} | Read rate {toNum(session.read_rate).toFixed(2)}/s
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Pill tone="border-white/15 bg-white/5 text-white/80">{String(session.status || "UNKNOWN").toUpperCase()}</Pill>
                        <Pill tone="border-cyan-500/35 bg-cyan-500/10 text-cyan-200">{`${toNum(session.accuracy_percent).toFixed(1)}% accuracy`}</Pill>
                        <Pill tone="border-amber-500/35 bg-amber-500/10 text-amber-200">{`${toNum(session.total_found).toLocaleString()} found`}</Pill>
                        <Pill tone="border-rose-500/35 bg-rose-500/10 text-rose-200">{`${toNum(session.total_missing).toLocaleString()} missing`}</Pill>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}

      {view === "sessions" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <Card
            title="Session Control"
            subtitle="Start a clean count, then close it once the handheld team finishes the scan."
            accent
            actions={
              canManage ? (
                activeSession?.status === "ACTIVE" ? (
                  <button type="button" onClick={endSession} disabled={actionLoading === "end"} className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-60">
                    {actionLoading === "end" ? "Closing..." : "End Active Session"}
                  </button>
                ) : (
                  <button type="button" onClick={startSession} disabled={actionLoading === "start" || !canManage} className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-60">
                    {actionLoading === "start" ? "Starting..." : "Start New Session"}
                  </button>
                )
              ) : null
            }
          >
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/65">Expected item count</label>
                <input type="number" min="0" step="1" value={expectedCount} onChange={(e) => setExpectedCount(e.target.value)} disabled={!canManage || activeSession?.status === "ACTIVE"} placeholder="Optional expected count" className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-amber-400/45" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric title="Session state" value={activeSession?.status === "ACTIVE" ? "LIVE" : "IDLE"} detail="Whether a controlled stock count is currently running." />
                <Metric title="Active reads" value={toNum(progress.reads).toLocaleString()} detail="Raw reads currently inside the live session." />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric title="Missing gap" value={missingCount.toLocaleString()} detail="Expected items still missing from the live count." />
                <Metric title="Read rate" value={`${sessionReadRate.toFixed(2)}/s`} detail={`Session time ${durationLabel(sessionDuration)}`} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/72">
                {canManage
                  ? "The handheld team can keep scanning while this session stays live. End the session once counting is complete so Xandora can lock the result and accuracy."
                  : "This account can monitor session progress, but a manager or admin must start and close sessions."}
              </div>
            </div>
          </Card>

          <Card title="Session History" subtitle="Track how each cycle count performed over time.">
            {!history.length ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
                No completed or active sessions found for this store yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-white/80">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                    <tr>
                      <th className="pb-3 pr-4">Session</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3 pr-4">Started</th>
                      <th className="pb-3 pr-4">Ended</th>
                      <th className="pb-3 pr-4">Found</th>
                      <th className="pb-3 pr-4">Missing</th>
                      <th className="pb-3 pr-4">Duration</th>
                      <th className="pb-3 pr-4">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((session) => (
                      <tr key={session.id} className="border-t border-white/8">
                        <td className="py-3 pr-4 text-white">{session.session_id || `#${session.id}`}</td>
                        <td className="py-3 pr-4"><Pill tone="border-white/15 bg-white/5 text-white/80">{String(session.status || "UNKNOWN").toUpperCase()}</Pill></td>
                        <td className="py-3 pr-4">{when(session.started_at)}</td>
                        <td className="py-3 pr-4">{when(session.ended_at)}</td>
                        <td className="py-3 pr-4">{toNum(session.total_found).toLocaleString()}</td>
                        <td className="py-3 pr-4">{toNum(session.total_missing).toLocaleString()}</td>
                        <td className="py-3 pr-4">{durationLabel(session.duration_seconds)}</td>
                        <td className="py-3 pr-4">{`${toNum(session.accuracy_percent).toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {view === "findings" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Card
            title="Current Audit Reads"
            subtitle={itemsSource === "recent_scans" ? "No live session was found, so these are recent scans for the selected store." : "These reads are attached to the active or latest session view."}
            accent
          >
            {!items.length ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
                No scanned items found for this store yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-white/80">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                    <tr>
                      <th className="pb-3 pr-4">EPC</th>
                      <th className="pb-3 pr-4">Product</th>
                      <th className="pb-3 pr-4">Brand</th>
                      <th className="pb-3 pr-4">Category</th>
                      <th className="pb-3 pr-4">Reads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 40).map((item) => (
                      <tr key={item.epc} className="border-t border-white/8">
                        <td className="py-3 pr-4 font-mono text-xs text-cyan-200">{item.epc}</td>
                        <td className="py-3 pr-4 text-white">{item.product_name || item.sku || "-"}</td>
                        <td className="py-3 pr-4">{item.brand || "-"}</td>
                        <td className="py-3 pr-4">{item.category || "-"}</td>
                        <td className="py-3 pr-4">{toNum(item.read_count).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Priority Findings" subtitle="Use this queue to reconcile the items most likely to need action.">
              {!riskItems.length ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-200">
                  No critical discrepancies are waiting right now.
                </div>
              ) : (
                <div className="space-y-3">
                  {riskItems.slice(0, 8).map((item) => (
                    <div key={item.group_key || `${item.sku}-${item.barcode}-${item.product_name}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{item.product_name || item.sku || item.barcode || "Unnamed item"}</div>
                          <div className="mt-1 text-xs text-white/55">{[item.brand, item.category, item.size_label].filter(Boolean).join(" | ") || "Audit finding"}</div>
                        </div>
                        <Pill tone={riskTone(item)}>
                          {item.risk_out_of_stock ? "Out of stock" : item.risk_high_return_rate ? "Return pressure" : item.risk_low_stock ? "Low stock" : "No scan"}
                        </Pill>
                      </div>
                      <div className="mt-3 text-sm text-white/70">
                        In stock: {toNum(item.in_stock_count).toLocaleString()} | Sold: {toNum(item.sold_count).toLocaleString()} | Last scan age: {toNum(item.days_since_scan).toLocaleString()} days
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Dead Stock Snapshot" subtitle="Items sitting in stock without movement still show up here for audit follow-up.">
              {!insights.dead_stock?.length ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
                  No dead stock items found in the current result set.
                </div>
              ) : (
                <div className="space-y-3">
                  {insights.dead_stock.slice(0, 6).map((item) => (
                    <div key={item.group_key || `${item.sku}-${item.barcode}-${item.product_name}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-semibold text-white">{item.product_name || item.sku || item.barcode || "Unnamed item"}</div>
                      <div className="mt-1 text-xs text-white/55">{[item.brand, item.category, item.size_label].filter(Boolean).join(" | ") || "Dead stock"}</div>
                      <div className="mt-3 text-sm text-white/72">{toNum(item.in_stock_count).toLocaleString()} units still in stock with no sold movement.</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Brand Pressure" subtitle="Grouped risk visibility by brand or product family.">
              {!brandRisks.length ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
                  No grouped risk pressure found yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {brandRisks.slice(0, 6).map((row) => (
                    <div key={row.brand} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-semibold text-white">{row.brand}</div>
                      <div className="mt-1 text-xs text-white/55">Max no-scan age: {toNum(row.max_no_scan_days)} days</div>
                      <div className="mt-3 text-sm text-white/72">
                        Low stock: {toNum(row.low_stock_units).toLocaleString()} | Demand gap: {toNum(row.out_of_stock_demand_units).toLocaleString()} | At risk: {toNum(row.at_risk_units).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
          Loading stock audit data...
        </div>
      ) : null}
    </div>
  );
}
