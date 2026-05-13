import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const EMPTY_SUMMARY = {
  expected_items_count: 0,
  scanned_items_count: 0,
  matched_items_count: 0,
  missing_items_count: 0,
  accuracy_percent: 0,
  total_reads: 0,
  duplicate_count: 0,
  unknown_count: 0,
  already_billed_count: 0,
  validation_failed_count: 0,
  duration_seconds: 0,
  read_rate: 0,
};

const LIVE_SCAN_WINDOW_MINUTES = 5;

function fmtTime(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function fmtDuration(seconds) {
  const total = Math.max(Number(seconds || 0), 0);
  if (!Number.isFinite(total) || total <= 0) return "0s";
  if (total < 60) return `${Math.round(total)}s`;
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function fmtMoney(value) {
  const amount = Number(value || 0);
  return `LKR ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function validationTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "MATCHED":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    case "UNKNOWN_EPC":
      return "border-amber-500/35 bg-amber-500/10 text-amber-200";
    case "ALREADY_BILLED":
      return "border-rose-500/35 bg-rose-500/10 text-rose-200";
    case "DUPLICATE":
      return "border-cyan-500/35 bg-cyan-500/10 text-cyan-200";
    default:
      return "border-orange-500/35 bg-orange-500/10 text-orange-200";
  }
}

function sessionTone(active) {
  return active
    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
    : "border-white/10 bg-white/5 text-white/75";
}

function Kpi({ title, value, detail = "" }) {
  return (
    <div className="glass rounded-lg p-3 border">
      <div className="text-[11px] opacity-60">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-[11px] opacity-60">{detail}</div> : null}
    </div>
  );
}

export default function BillingPanel() {
  const { isAdmin } = useAuth();

  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
  );
  const [expected, setExpected] = useState(10);
  const [session, setSession] = useState(null);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [scans, setScans] = useState([]);
  const [scanSource, setScanSource] = useState("active_session");
  const [manualEpc, setManualEpc] = useState("");
  const [lastValidation, setLastValidation] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const storeRef = useRef(storeId);

  useEffect(() => {
    storeRef.current = storeId;
  }, [storeId]);

  async function load(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    setLoading(true);
    setError("");

    try {
      const [scansRes, summaryRes] = await Promise.all([
        apiGet(
          `/billing/scans?store_id=${encodeURIComponent(sid)}&minutes=${LIVE_SCAN_WINDOW_MINUTES}`
        ),
        apiGet(`/billing/summary?store_id=${encodeURIComponent(sid)}`),
      ]);

      const source = String(scansRes?.source || "active_session");
      const cutoff = Date.now() - LIVE_SCAN_WINDOW_MINUTES * 60 * 1000;
      const scanRows = Array.isArray(scansRes?.scans) ? scansRes.scans : [];
      const liveRows =
        source === "recent_scans"
          ? scanRows.filter((scan) => {
              const seenAt = Date.parse(scan?.last_seen || scan?.first_seen);
              return Number.isFinite(seenAt) && seenAt >= cutoff;
            })
          : scanRows;

      setScans(liveRows);
      setSession(scansRes?.session || summaryRes?.session || null);
      setScanSource(source);
      setSummary(summaryRes?.summary || EMPTY_SUMMARY);
    } catch (err) {
      console.error("[BillingPanel] load failed:", err);
      setError(err?.error || err?.message || "Failed to load billing session");
      setSession(null);
      setScans([]);
      setScanSource("active_session");
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(activeStoreId) {
    const sid = activeStoreId || storeRef.current;
    setHistoryLoading(true);

    try {
      const response = await apiGet(
        `/billing/sessions?store_id=${encodeURIComponent(sid)}&limit=10`
      );
      setHistory(Array.isArray(response?.sessions) ? response.sessions : []);
    } catch (err) {
      console.warn("[BillingPanel] history failed:", err?.message || err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function startSession() {
    setBusy(true);
    setError("");
    setLastValidation(null);

    try {
      await apiPost("/billing/start", {
        store_id: storeRef.current,
        expected_items_count: Number(expected || 0),
        pos_terminal_id: "POS_1",
      });
      await Promise.all([load(), loadHistory()]);
    } catch (err) {
      setError(err?.error || err?.message || "Failed to start billing session");
    } finally {
      setBusy(false);
    }
  }

  async function scanManualEpc() {
    const epc = String(manualEpc || "").trim();
    if (!epc) {
      setError("Enter an EPC first");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await apiPost("/billing/scan", {
        store_id: storeRef.current,
        epc,
        device_id: "UI_MANUAL",
      });

      setLastValidation(response?.validation || null);
      setManualEpc("");
      await load();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to scan EPC");
    } finally {
      setBusy(false);
    }
  }

  async function completeSession() {
    setBusy(true);
    setError("");

    try {
      await apiPost("/billing/complete", {
        store_id: storeRef.current,
        notes: "Completed via UI",
      });
      await Promise.all([load(), loadHistory()]);
      setLastValidation(null);
    } catch (err) {
      setError(err?.error || err?.message || "Failed to complete billing session");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    setBusy(true);
    setError("");

    try {
      await apiPost("/billing/cancel", {
        store_id: storeRef.current,
        notes: "Cancelled via UI",
      });
      await Promise.all([load(), loadHistory()]);
      setLastValidation(null);
    } catch (err) {
      setError(err?.error || err?.message || "Failed to cancel billing session");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    loadHistory();

    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        load();
      }
    }, 3000);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("xandora_store_id") || "STORE_001";
      setStoreId(sid);
      storeRef.current = sid;
      setLastValidation(null);
      load(sid);
      loadHistory(sid);
    }

    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
  }, []);

  const hasActive = session?.status === "ACTIVE" || Boolean(session?.id);

  const derived = useMemo(() => {
    const lastSeen = scans[0]?.last_seen || scans[0]?.first_seen || session?.last_scan_at || null;
    const progressPercent =
      Number(summary.expected_items_count || 0) > 0
        ? Math.max(
            0,
            Math.min(
              (Number(summary.matched_items_count || 0) /
                Number(summary.expected_items_count || 1)) *
                100,
              100
            )
          )
        : 0;

    let liveState = "Ready";
    if (loading) {
      liveState = "Refreshing";
    } else if (summary.validation_failed_count > 0 || lastValidation?.validation_status === "VALIDATION_FAILED") {
      liveState = "Validation service unavailable";
    } else if (hasActive && scans.length === 0) {
      liveState = "Waiting for scans";
    } else if (hasActive) {
      liveState = "Live validation";
    } else if (scanSource === "recent_scans") {
      liveState = "No active session";
    }

    return {
      lastSeen,
      progressPercent,
      liveState,
      totalRows: scans.length,
    };
  }, [hasActive, lastValidation, loading, scanSource, scans, session?.last_scan_at, summary]);

  return (
    <div className="glass rounded-xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] opacity-60">
            Billing Session
          </div>
          <div className="mt-1 text-lg font-semibold">Live POS validation control</div>
        </div>
        <button
          onClick={() => {
            load();
            loadHistory();
          }}
          className="rounded border px-3 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <div>
              Store: <strong>{storeId}</strong>
            </div>
            <div>
              Session:{" "}
              <strong>{session?.session_id || (hasActive ? `#${session?.id}` : "Not started")}</strong>
            </div>
            <div>
              Operator: <strong>{session?.operator_label || session?.created_by_email || "System"}</strong>
            </div>
            <div className="text-xs opacity-70">
              Last activity: {fmtTime(derived.lastSeen)}
            </div>
          </div>

          <div className="space-y-2 text-right">
            <div
              className={`inline-flex rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${sessionTone(
                hasActive
              )}`}
            >
              {hasActive ? "Active" : "Idle"}
            </div>
            <div className="text-xs opacity-70">{derived.liveState}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] opacity-60">
            <span>Matched progress</span>
            <span>
              {summary.matched_items_count}/{summary.expected_items_count || 0}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#16F9F3_0%,#22C55E_100%)] transition-all"
              style={{ width: `${derived.progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {lastValidation ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${validationTone(
            lastValidation.validation_status
          )}`}
        >
          <div className="font-semibold">{lastValidation.validation_label}</div>
          <div className="mt-1">{lastValidation.validation_message}</div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Expected" value={hasActive ? summary.expected_items_count : expected} />
        <Kpi title="Matched" value={summary.matched_items_count} />
        <Kpi title="Missing" value={summary.missing_items_count} />
        <Kpi title="Read Rate" value={`${Number(summary.read_rate || 0).toFixed(2)}/s`} />
        <Kpi title="Session Time" value={fmtDuration(summary.duration_seconds)} />
        <Kpi title="Unique EPCs" value={summary.scanned_items_count || derived.totalRows} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi title="Total Reads" value={summary.total_reads} />
        <Kpi title="Duplicates" value={summary.duplicate_count} />
        <Kpi title="Unknown EPC" value={summary.unknown_count} />
        <Kpi title="Already Billed" value={summary.already_billed_count} />
        <Kpi title="Validation Failed" value={summary.validation_failed_count} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min="0"
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
          disabled={hasActive || busy}
          className="w-28 rounded border bg-transparent px-3 py-2"
        />

        {!hasActive ? (
          <button
            onClick={startSession}
            disabled={busy}
            className="rounded border px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Start Billing
          </button>
        ) : (
          <>
            <button
              onClick={completeSession}
              disabled={busy}
              className="rounded border px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Complete
            </button>
            <button
              onClick={cancelSession}
              disabled={busy}
              className="rounded border border-red-500/30 px-4 py-2 hover:bg-red-500/10"
            >
              Cancel
            </button>
          </>
        )}

        {isAdmin ? <div className="ml-auto text-xs opacity-60">Admin</div> : null}
      </div>

      <div className="mt-4 rounded-lg border p-3">
        <div className="mb-2 text-xs">Manual EPC Scan (Testing)</div>
        <div className="flex gap-2">
          <input
            value={manualEpc}
            onChange={(event) => setManualEpc(event.target.value)}
            className="flex-1 rounded border bg-transparent px-3 py-2"
            placeholder="E200..."
            disabled={busy}
          />
          <button
            onClick={scanManualEpc}
            disabled={busy}
            className="rounded border px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Scan
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-3">
        <div className="mb-2 text-xs">
          {scanSource === "active_session"
            ? `Active Session Items (${scans.length})`
            : `Live Validated Scans - Last ${LIVE_SCAN_WINDOW_MINUTES} min (${scans.length})`}
        </div>

        {scans.length === 0 ? (
          <div className="text-xs opacity-60">
            {hasActive
              ? "Waiting for confirmed EPC reads from the active billing session."
              : `No live validated scans in the last ${LIVE_SCAN_WINDOW_MINUTES} minutes.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-3">EPC</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Reads</th>
                  <th className="py-2 pr-3">Last Seen</th>
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.epc}
                    className="border-b border-white/5 align-top hover:bg-white/5"
                  >
                    <td className="py-2 pr-3 font-mono">{scan.epc}</td>
                    <td className="py-2 pr-3">
                      <div>{scan.product_name || scan.sku || "Unmapped item"}</div>
                      <div className="mt-1 text-[10px] opacity-60">
                        {[scan.brand, scan.category, scan.size_label]
                          .filter(Boolean)
                          .join(" | ") || "-"}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${validationTone(
                          scan.validation_status
                        )}`}
                      >
                        {scan.validation_label || scan.validation_status || "Validation failed"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{scan.read_count || 0}</td>
                    <td className="py-2 pr-3">{fmtTime(scan.last_seen || scan.first_seen)}</td>
                    <td className="py-2 pr-3">{fmtMoney(scan.price_lkr)}</td>
                    <td className="py-2 pr-3">
                      <span className="opacity-70">{scan.validation_message || "-"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border p-3">
        <div className="mb-2 flex justify-between">
          <div className="text-xs">Billing History</div>
          <button onClick={() => loadHistory()} className="rounded border px-3 py-1 text-xs">
            {historyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!history.length ? (
          <div className="text-xs opacity-60">No billing sessions recorded for this store yet.</div>
        ) : (
          <div className="space-y-2">
            {history.map((item) => (
              <div key={item.id} className="glass rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {item.session_id || `Session #${item.id}`} · {item.status}
                    </div>
                    <div className="text-xs opacity-70">
                      {fmtTime(item.started_at)} to {fmtTime(item.ended_at)}
                    </div>
                    <div className="mt-1 text-xs opacity-60">
                      Duration {fmtDuration(item.duration_seconds)} · Read rate{" "}
                      {Number(item.read_rate || 0).toFixed(2)}/s
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div>
                      {item.matched_items_count || 0}/{item.expected_items_count || 0} matched
                    </div>
                    <div className="font-semibold">
                      {Number(item.accuracy_percent || 0).toFixed(1)}%
                    </div>
                    <div className="mt-1 opacity-60">
                      Missing {item.missing_items_count || 0} · Unknown {item.metrics_summary?.unknown_count || 0}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
