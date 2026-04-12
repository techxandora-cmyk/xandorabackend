// src/components/AlertsPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function formatAgo(ms) {
  if (!ms || ms < 0) return "-";
  const s = Math.floor(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function toToneBySeverity(severity) {
  const n = Number(severity);
  if (!Number.isFinite(n)) return "neutral";
  if (n >= 80) return "red";
  if (n >= 60) return "yellow";
  if (n >= 30) return "blue";
  return "neutral";
}

function toneByCasePriority(priority) {
  const p = String(priority || "").toUpperCase();
  if (p === "CRITICAL") return "red";
  if (p === "HIGH") return "yellow";
  if (p === "MEDIUM") return "blue";
  return "neutral";
}

function toneByCaseStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "RESOLVED") return "green";
  if (s === "IN_PROGRESS") return "yellow";
  return "neutral";
}

function Badge({ children, tone = "neutral" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
      : tone === "yellow"
      ? "bg-amber-500/15 text-amber-300 border-amber-500/20"
      : tone === "red"
      ? "bg-rose-500/15 text-rose-300 border-rose-500/20"
      : tone === "blue"
      ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/20"
      : "bg-white/5 text-white/70 border-white/10";

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border ${cls}`}>
      {children}
    </span>
  );
}

export default function AlertsPanel() {
  const auth = useAuth();
  const isAdmin = !!auth?.isAdmin || !!auth?.isMasterAdmin;

  const [store_id, setStoreId] = useState(
    () => localStorage.getItem("zyro_store_id") || "STORE_001"
  );

  const [alerts, setAlerts] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [actingId, setActingId] = useState("");
  const [noteDraftByCase, setNoteDraftByCase] = useState({});

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const [viewMode, setViewMode] = useState("ALERTS"); // ALERTS | CASES
  const [alertTab, setAlertTab] = useState("OPERATIONAL"); // OPERATIONAL | SYSTEM
  const [showResolvedAlerts, setShowResolvedAlerts] = useState(false);
  const [caseFilter, setCaseFilter] = useState("ACTIVE"); // ACTIVE | ALL | RESOLVED

  async function load(activeStoreId) {
    const sid = activeStoreId || store_id;
    setLoading(true);
    setErr("");

    try {
      const alertsRes = await apiGet(`/alerts?store_id=${encodeURIComponent(sid)}`);
      setAlerts(Array.isArray(alertsRes?.alerts) ? alertsRes.alerts : []);

      try {
        const casesRes = await apiGet(`/alerts/cases?store_id=${encodeURIComponent(sid)}&limit=300`);
        setCases(Array.isArray(casesRes?.cases) ? casesRes.cases : []);
      } catch (e) {
        if (Number(e?.status) === 404) {
          setCases([]);
        } else {
          throw e;
        }
      }

      setLastUpdatedAt(Date.now());
    } catch (e) {
      console.error("[AlertsPanel] load failed:", e);
      setErr(e?.error || "Failed to load alerts/cases");
      setAlerts([]);
      setCases([]);
    } finally {
      setLoading(false);
    }
  }

  async function resolveAlert(id) {
    if (!id) return;
    setActingId(`alert-resolve-${id}`);
    setErr("");
    try {
      await apiPut(`/alerts/${id}/resolve`, {});
      await load(store_id);
    } catch (e) {
      console.error("[AlertsPanel] resolve failed:", e);
      setErr(e?.error || "Failed to resolve alert");
    } finally {
      setActingId("");
    }
  }

  async function createCaseFromAlert(alert) {
    const alertId = Number(alert?.id || 0);
    if (!alertId) return;
    setActingId(`alert-case-${alertId}`);
    setErr("");
    try {
      await apiPost(`/alerts/cases/from-alert/${alertId}`, {
        store_id: alert?.store_id || store_id,
        assign_to_me: true,
      });
      await load(store_id);
      setViewMode("CASES");
      setCaseFilter("ACTIVE");
    } catch (e) {
      console.error("[AlertsPanel] create case failed:", e);
      setErr(e?.error || "Failed to open case");
    } finally {
      setActingId("");
    }
  }

  async function updateCaseStatus(caseRow, nextStatus) {
    const caseId = Number(caseRow?.id || 0);
    if (!caseId) return;
    setActingId(`case-status-${caseId}`);
    setErr("");
    try {
      await apiPut(`/alerts/cases/${caseId}`, { status: nextStatus });
      await load(store_id);
    } catch (e) {
      console.error("[AlertsPanel] update case status failed:", e);
      setErr(e?.error || "Failed to update case");
    } finally {
      setActingId("");
    }
  }

  async function assignCaseToMe(caseRow) {
    const caseId = Number(caseRow?.id || 0);
    if (!caseId) return;
    setActingId(`case-assign-${caseId}`);
    setErr("");
    try {
      await apiPut(`/alerts/cases/${caseId}`, {
        assigned_to_user_id: auth?.user?.user_id || null,
        assigned_to_email: auth?.user?.email || null,
        assigned_to_name: auth?.user?.email || null,
      });
      await load(store_id);
    } catch (e) {
      console.error("[AlertsPanel] assign case failed:", e);
      setErr(e?.error || "Failed to assign case");
    } finally {
      setActingId("");
    }
  }

  async function addCaseNote(caseRow) {
    const caseId = Number(caseRow?.id || 0);
    if (!caseId) return;
    const note = String(noteDraftByCase[caseId] || "").trim();
    if (!note) return;

    setActingId(`case-note-${caseId}`);
    setErr("");
    try {
      await apiPost(`/alerts/cases/${caseId}/notes`, { note });
      setNoteDraftByCase((prev) => ({ ...prev, [caseId]: "" }));
      await load(store_id);
    } catch (e) {
      console.error("[AlertsPanel] case note failed:", e);
      setErr(e?.error || "Failed to add note");
    } finally {
      setActingId("");
    }
  }

  useEffect(() => {
    load(store_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onStoreChanged() {
      const sid = localStorage.getItem("zyro_store_id") || "STORE_001";
      setStoreId(sid);
      load(sid);
    }

    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () => window.removeEventListener("zyro_store_changed", onStoreChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        load(store_id);
      }
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, store_id]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const updatedAgo = formatAgo(nowTick - (lastUpdatedAt || 0));

  const filteredAlerts = useMemo(() => {
    let rows = Array.isArray(alerts) ? alerts : [];

    rows = rows.filter((a) => {
      const t = String(a.type || "").toUpperCase();
      const group = t.includes("SYSTEM") ? "SYSTEM" : "OPERATIONAL";
      return group === alertTab;
    });

    if (!showResolvedAlerts) {
      rows = rows.filter((a) => String(a.status || "").toUpperCase() === "OPEN");
    }

    rows.sort((a, b) => {
      const aStatus = String(a.status || "").toUpperCase();
      const bStatus = String(b.status || "").toUpperCase();
      if (aStatus !== bStatus) return aStatus === "OPEN" ? -1 : 1;
      return new Date(b.last_detected_at || 0) - new Date(a.last_detected_at || 0);
    });

    return rows;
  }, [alerts, alertTab, showResolvedAlerts]);

  const filteredCases = useMemo(() => {
    const rows = Array.isArray(cases) ? [...cases] : [];
    const out = rows.filter((c) => {
      const s = String(c.status || "").toUpperCase();
      if (caseFilter === "ACTIVE") return s === "OPEN" || s === "IN_PROGRESS";
      if (caseFilter === "RESOLVED") return s === "RESOLVED";
      return true;
    });

    out.sort((a, b) => {
      const rank = { OPEN: 0, IN_PROGRESS: 1, RESOLVED: 2 };
      const sa = rank[String(a.status || "").toUpperCase()] ?? 9;
      const sb = rank[String(b.status || "").toUpperCase()] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });

    return out;
  }, [cases, caseFilter]);

  const openAlertCount = useMemo(
    () => alerts.filter((a) => String(a.status || "").toUpperCase() === "OPEN").length,
    [alerts]
  );
  const activeCaseCount = useMemo(
    () =>
      cases.filter((c) => {
        const s = String(c.status || "").toUpperCase();
        return s === "OPEN" || s === "IN_PROGRESS";
      }).length,
    [cases]
  );

  return (
    <div className="glass rounded-xl p-5 border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[11px]">Alerts + Cases</div>
          <Badge>Store: {store_id}</Badge>
          <Badge tone="red">Open Alerts: {openAlertCount}</Badge>
          <Badge tone="yellow">Active Cases: {activeCaseCount}</Badge>
        </div>

        <button onClick={() => load(store_id)} className="px-3 py-1 rounded border text-xs">
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3 text-[11px] opacity-70">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"
          }`}
        />
        <span>{autoRefresh ? "Live" : "Paused"}</span>
        <span>-</span>
        <span>Updated {lastUpdatedAt ? updatedAgo : "-"}</span>
        <button onClick={() => setAutoRefresh((v) => !v)} className="ml-2 px-2 py-1 rounded border">
          {autoRefresh ? "Pause" : "Resume"}
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-red-500">{err}</div>}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setViewMode("ALERTS")}
          className={`px-3 py-1 rounded border text-xs ${
            viewMode === "ALERTS" ? "bg-white/10" : "hover:bg-white/5"
          }`}
        >
          Alerts
        </button>
        <button
          onClick={() => setViewMode("CASES")}
          className={`px-3 py-1 rounded border text-xs ${
            viewMode === "CASES" ? "bg-white/10" : "hover:bg-white/5"
          }`}
        >
          Cases
        </button>
      </div>

      {viewMode === "ALERTS" && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setAlertTab("OPERATIONAL")}
              className={`px-3 py-1 rounded border text-xs ${
                alertTab === "OPERATIONAL" ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              Operational
            </button>
            <button
              onClick={() => setAlertTab("SYSTEM")}
              className={`px-3 py-1 rounded border text-xs ${
                alertTab === "SYSTEM" ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              System
            </button>
            <button
              onClick={() => setShowResolvedAlerts((v) => !v)}
              className="ml-auto px-3 py-1 rounded border text-xs"
            >
              {showResolvedAlerts ? "Showing: All" : "Showing: Open Only"}
            </button>
          </div>

          {filteredAlerts.length === 0 ? (
            <div className="text-sm opacity-50">No alerts found</div>
          ) : (
            <div className="space-y-2">
              {filteredAlerts.map((a) => {
                const status = String(a.status || "").toUpperCase();
                const canResolve = status === "OPEN" && isAdmin;
                const hasOpenCase = Number(a.open_case_count || 0) > 0;
                const alertActionId = `alert-resolve-${a.id}`;
                const caseActionId = `alert-case-${a.id}`;

                return (
                  <div
                    key={a.id}
                    className="glass rounded-lg p-3 border flex justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-sm">{a.type || "ALERT"}</div>
                        <Badge tone={toToneBySeverity(a.severity)}>Severity {a.severity}</Badge>
                        <Badge tone={status === "RESOLVED" ? "green" : "neutral"}>{status}</Badge>
                        <Badge tone={hasOpenCase ? "blue" : "neutral"}>
                          Cases: {Number(a.open_case_count || 0)}
                        </Badge>

                        {canResolve && (
                          <button
                            onClick={() => resolveAlert(a.id)}
                            disabled={actingId === alertActionId}
                            className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                          >
                            {actingId === alertActionId ? "Resolving..." : "Resolve"}
                          </button>
                        )}

                        {isAdmin && (
                          <button
                            onClick={() => createCaseFromAlert(a)}
                            disabled={actingId === caseActionId}
                            className="px-2 py-1 rounded border text-[11px] border-cyan-500/40 text-cyan-300 disabled:opacity-50"
                          >
                            {hasOpenCase ? "View Case" : "Open Case"}
                          </button>
                        )}
                      </div>

                      <div className="text-xs opacity-60 mt-1">
                        Store: {a.store_id || "GLOBAL"} - {a.entity_type}:{a.entity_id}
                        {a.latest_case_ref ? ` - ${a.latest_case_ref}` : ""}
                      </div>
                    </div>

                    <div className="text-xs opacity-60 whitespace-nowrap">
                      {a.last_detected_at ? new Date(a.last_detected_at).toLocaleString() : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {viewMode === "CASES" && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setCaseFilter("ACTIVE")}
              className={`px-3 py-1 rounded border text-xs ${
                caseFilter === "ACTIVE" ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setCaseFilter("RESOLVED")}
              className={`px-3 py-1 rounded border text-xs ${
                caseFilter === "RESOLVED" ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              Resolved
            </button>
            <button
              onClick={() => setCaseFilter("ALL")}
              className={`px-3 py-1 rounded border text-xs ${
                caseFilter === "ALL" ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              All
            </button>
          </div>

          {filteredCases.length === 0 ? (
            <div className="text-sm opacity-50">No cases found</div>
          ) : (
            <div className="space-y-3">
              {filteredCases.map((c) => {
                const status = String(c.status || "").toUpperCase();
                const cid = Number(c.id || 0);
                const actionIdStatus = `case-status-${cid}`;
                const actionIdAssign = `case-assign-${cid}`;
                const actionIdNote = `case-note-${cid}`;
                const assigned =
                  c.assigned_to_name || c.assigned_to_email || "Unassigned";

                return (
                  <div key={cid} className="glass rounded-lg p-3 border space-y-2">
                    <div className="flex justify-between gap-3 items-start">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-sm">
                            {c.case_ref || `Case #${cid}`} - {c.title}
                          </div>
                          <Badge tone={toneByCasePriority(c.priority)}>
                            {String(c.priority || "MEDIUM").toUpperCase()}
                          </Badge>
                          <Badge tone={toneByCaseStatus(status)}>{status}</Badge>
                          <Badge tone="blue">Events: {Number(c.event_count || 0)}</Badge>
                        </div>
                        <div className="text-xs opacity-60 mt-1">
                          Store: {c.store_id || "-"} - Assigned: {assigned}
                          {c.alert_id ? ` - Alert #${c.alert_id}` : ""}
                        </div>
                      </div>
                      <div className="text-xs opacity-60 whitespace-nowrap">
                        {c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}
                      </div>
                    </div>

                    {c.description && <div className="text-xs opacity-80">{c.description}</div>}

                    <div className="flex gap-2 flex-wrap">
                      {isAdmin && (
                        <button
                          onClick={() => assignCaseToMe(c)}
                          disabled={actingId === actionIdAssign}
                          className="px-2 py-1 rounded border text-[11px] border-cyan-500/40 text-cyan-300 disabled:opacity-50"
                        >
                          {actingId === actionIdAssign ? "Assigning..." : "Assign to Me"}
                        </button>
                      )}

                      {isAdmin && status === "OPEN" && (
                        <button
                          onClick={() => updateCaseStatus(c, "IN_PROGRESS")}
                          disabled={actingId === actionIdStatus}
                          className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                        >
                          {actingId === actionIdStatus ? "Updating..." : "Start"}
                        </button>
                      )}

                      {isAdmin && (status === "OPEN" || status === "IN_PROGRESS") && (
                        <button
                          onClick={() => updateCaseStatus(c, "RESOLVED")}
                          disabled={actingId === actionIdStatus}
                          className="px-2 py-1 rounded border text-[11px] border-emerald-500/40 text-emerald-300 disabled:opacity-50"
                        >
                          {actingId === actionIdStatus ? "Updating..." : "Resolve"}
                        </button>
                      )}

                      {isAdmin && status === "RESOLVED" && (
                        <button
                          onClick={() => updateCaseStatus(c, "OPEN")}
                          disabled={actingId === actionIdStatus}
                          className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                        >
                          {actingId === actionIdStatus ? "Updating..." : "Reopen"}
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={noteDraftByCase[cid] || ""}
                        onChange={(e) =>
                          setNoteDraftByCase((prev) => ({
                            ...prev,
                            [cid]: e.target.value,
                          }))
                        }
                        placeholder="Add case note..."
                        className="flex-1 px-2 py-1 rounded border bg-white/5 border-white/10 text-xs"
                      />
                      <button
                        onClick={() => addCaseNote(c)}
                        disabled={actingId === actionIdNote}
                        className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                      >
                        {actingId === actionIdNote ? "Adding..." : "Add Note"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
