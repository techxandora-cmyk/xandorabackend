// src/components/AlertsPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  UserPlus,
} from "lucide-react";
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

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "-";
  }
}

function cleanLabel(value, fallback = "Alert") {
  const raw = String(value || fallback).trim();
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityInfo(severity) {
  const n = Number(severity);
  if (!Number.isFinite(n)) {
    return { label: "Info", tone: "neutral", rank: 0 };
  }
  if (n >= 80) return { label: "Critical", tone: "red", rank: 4 };
  if (n >= 60) return { label: "High", tone: "yellow", rank: 3 };
  if (n >= 30) return { label: "Medium", tone: "blue", rank: 2 };
  return { label: "Low", tone: "green", rank: 1 };
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

function toneClasses(tone = "neutral") {
  if (tone === "green") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300 dark:text-emerald-300";
  }
  if (tone === "yellow") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300 dark:text-amber-300";
  }
  if (tone === "red") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300 dark:text-rose-300";
  }
  if (tone === "blue") {
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 dark:text-cyan-300";
  }
  return "border-white/10 bg-white/5 text-black/65 dark:text-white/70";
}

function Badge({ children, tone = "neutral" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${toneClasses(tone)}`}>
      {children}
    </span>
  );
}

function SegmentButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-3 py-1.5 text-xs transition",
        active
          ? "border-cyan-500/45 bg-cyan-500/12 text-cyan-200"
          : "border-white/10 text-black/65 hover:bg-white/8 dark:text-white/70",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function IconButton({ children, icon: Icon, tone = "neutral", ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "green"
          ? "border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10"
          : tone === "blue"
          ? "border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/10"
          : "border-white/12 text-black/70 hover:bg-white/8 dark:text-white/75",
      ].join(" ")}
    >
      {Icon ? <Icon size={13} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

function MetricCard({ title, value, hint, tone = "neutral", icon: Icon }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-black/55 dark:text-white/50">{title}</div>
        {Icon ? <Icon className={toneClasses(tone).split(" ").find((c) => c.startsWith("text-")) || ""} size={15} /> : null}
      </div>
      <div className="mt-1 text-2xl font-semibold text-black/85 dark:text-white/90">{value}</div>
      <div className="mt-1 text-[11px] text-black/45 dark:text-white/40">{hint}</div>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-4 py-8 text-center">
      <div className="text-sm font-medium text-black/70 dark:text-white/75">{title}</div>
      <div className="mt-1 text-xs text-black/45 dark:text-white/45">{detail}</div>
    </div>
  );
}

export default function AlertsPanel() {
  const auth = useAuth();
  const isAdmin = !!auth?.isAdmin || !!auth?.isMasterAdmin;

  const [store_id, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
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

  const [viewMode, setViewMode] = useState("ALERTS");
  const [alertTab, setAlertTab] = useState("OPERATIONAL");
  const [showResolvedAlerts, setShowResolvedAlerts] = useState(false);
  const [caseFilter, setCaseFilter] = useState("ACTIVE");

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
        if (Number(e?.status) === 404) setCases([]);
        else throw e;
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
      const sid = localStorage.getItem("xandora_store_id") || "STORE_001";
      setStoreId(sid);
      load(sid);
    }

    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(store_id);
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
    let rows = Array.isArray(alerts) ? [...alerts] : [];

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
      const severityDelta = severityInfo(b.severity).rank - severityInfo(a.severity).rank;
      if (severityDelta) return severityDelta;
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
  const urgentAlertCount = useMemo(
    () =>
      alerts.filter(
        (a) =>
          String(a.status || "").toUpperCase() === "OPEN" &&
          severityInfo(a.severity).rank >= 3
      ).length,
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Open Alerts" value={openAlertCount} hint={`Store ${store_id}`} tone="red" icon={Bell} />
        <MetricCard title="High Priority" value={urgentAlertCount} hint="Critical or high severity" tone="yellow" icon={AlertTriangle} />
        <MetricCard title="Active Cases" value={activeCaseCount} hint="Open or in progress" tone="blue" icon={ClipboardList} />
        <MetricCard title="Refresh" value={lastUpdatedAt ? updatedAgo : "-"} hint={autoRefresh ? "Live polling on" : "Live polling paused"} tone={autoRefresh ? "green" : "neutral"} icon={autoRefresh ? Play : Pause} />
      </div>

      <div className="glass rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="text-sm font-semibold text-black/85 dark:text-white/90">
              Alert Center
            </div>
            <div className="mt-1 text-xs text-black/50 dark:text-white/50">
              Review live operational issues, assign follow-up, and close resolved events.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon={autoRefresh ? Pause : Play} onClick={() => setAutoRefresh((v) => !v)}>
              {autoRefresh ? "Pause" : "Resume"}
            </IconButton>
            <IconButton icon={RefreshCw} onClick={() => load(store_id)} disabled={loading}>
              {loading ? "Loading" : "Refresh"}
            </IconButton>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SegmentButton active={viewMode === "ALERTS"} onClick={() => setViewMode("ALERTS")}>
            Alerts
          </SegmentButton>
          <SegmentButton active={viewMode === "CASES"} onClick={() => setViewMode("CASES")}>
            Cases
          </SegmentButton>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-black/45 dark:text-white/45">
            <span className={`h-2 w-2 rounded-full ${autoRefresh ? "bg-emerald-400" : "bg-zinc-400"}`} />
            <span>{lastUpdatedAt ? `Updated ${updatedAgo}` : "Not loaded yet"}</span>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {err}
          </div>
        ) : null}

        {viewMode === "ALERTS" ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentButton active={alertTab === "OPERATIONAL"} onClick={() => setAlertTab("OPERATIONAL")}>
                Operational
              </SegmentButton>
              <SegmentButton active={alertTab === "SYSTEM"} onClick={() => setAlertTab("SYSTEM")}>
                System
              </SegmentButton>
              <SegmentButton active={showResolvedAlerts} onClick={() => setShowResolvedAlerts((v) => !v)}>
                {showResolvedAlerts ? "All Alerts" : "Open Only"}
              </SegmentButton>
            </div>

            {loading && filteredAlerts.length === 0 ? (
              <EmptyState title="Loading alerts" detail="Checking the latest store signals." />
            ) : filteredAlerts.length === 0 ? (
              <EmptyState title="No alerts to review" detail="This store has no matching alerts right now." />
            ) : (
              <div className="space-y-3">
                {filteredAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    actingId={actingId}
                    isAdmin={isAdmin}
                    onResolve={resolveAlert}
                    onCreateCase={createCaseFromAlert}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentButton active={caseFilter === "ACTIVE"} onClick={() => setCaseFilter("ACTIVE")}>
                Active
              </SegmentButton>
              <SegmentButton active={caseFilter === "RESOLVED"} onClick={() => setCaseFilter("RESOLVED")}>
                Resolved
              </SegmentButton>
              <SegmentButton active={caseFilter === "ALL"} onClick={() => setCaseFilter("ALL")}>
                All
              </SegmentButton>
            </div>

            {loading && filteredCases.length === 0 ? (
              <EmptyState title="Loading cases" detail="Checking follow-up work for this store." />
            ) : filteredCases.length === 0 ? (
              <EmptyState title="No cases found" detail="There are no cases in this filter." />
            ) : (
              <div className="space-y-3">
                {filteredCases.map((caseRow) => (
                  <CaseCard
                    key={caseRow.id}
                    caseRow={caseRow}
                    actingId={actingId}
                    isAdmin={isAdmin}
                    noteDraft={noteDraftByCase[Number(caseRow.id || 0)] || ""}
                    onNoteChange={(value) =>
                      setNoteDraftByCase((prev) => ({
                        ...prev,
                        [Number(caseRow.id || 0)]: value,
                      }))
                    }
                    onAssign={assignCaseToMe}
                    onStatus={updateCaseStatus}
                    onAddNote={addCaseNote}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertCard({ alert, actingId, isAdmin, onResolve, onCreateCase }) {
  const status = String(alert.status || "").toUpperCase();
  const severity = severityInfo(alert.severity);
  const hasOpenCase = Number(alert.open_case_count || 0) > 0;
  const canResolve = status === "OPEN" && isAdmin;
  const alertActionId = `alert-resolve-${alert.id}`;
  const caseActionId = `alert-case-${alert.id}`;
  const entityText = [alert.entity_type, alert.entity_id].filter(Boolean).join(":") || "Store signal";

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
      <div className={`h-1 ${severity.tone === "red" ? "bg-rose-400" : severity.tone === "yellow" ? "bg-amber-400" : severity.tone === "blue" ? "bg-cyan-400" : "bg-white/20"}`} />
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-black/85 dark:text-white/90">
                {cleanLabel(alert.type, "Alert")}
              </div>
              <Badge tone={severity.tone}>{severity.label}</Badge>
              <Badge tone={status === "RESOLVED" ? "green" : "neutral"}>{cleanLabel(status, "Open")}</Badge>
              {hasOpenCase ? <Badge tone="blue">{alert.latest_case_ref || "Case open"}</Badge> : null}
            </div>
            <div className="mt-2 text-xs text-black/55 dark:text-white/50">
              {entityText} · Store {alert.store_id || "GLOBAL"}
            </div>
          </div>

          <div className="text-right text-xs text-black/45 dark:text-white/45">
            <div>Last detected</div>
            <div className="mt-0.5 text-black/65 dark:text-white/65">
              {formatDateTime(alert.last_detected_at)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canResolve ? (
            <IconButton
              icon={CheckCircle2}
              tone="green"
              onClick={() => onResolve(alert.id)}
              disabled={actingId === alertActionId}
            >
              {actingId === alertActionId ? "Resolving" : "Resolve"}
            </IconButton>
          ) : null}

          {isAdmin ? (
            <IconButton
              icon={ClipboardList}
              tone="blue"
              onClick={() => onCreateCase(alert)}
              disabled={actingId === caseActionId}
            >
              {actingId === caseActionId ? "Opening" : hasOpenCase ? "Open Case" : "Create Case"}
            </IconButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CaseCard({
  caseRow,
  actingId,
  isAdmin,
  noteDraft,
  onNoteChange,
  onAssign,
  onStatus,
  onAddNote,
}) {
  const cid = Number(caseRow.id || 0);
  const status = String(caseRow.status || "").toUpperCase();
  const actionIdStatus = `case-status-${cid}`;
  const actionIdAssign = `case-assign-${cid}`;
  const actionIdNote = `case-note-${cid}`;
  const assigned = caseRow.assigned_to_name || caseRow.assigned_to_email || "Unassigned";

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-black/85 dark:text-white/90">
              {caseRow.case_ref || `Case #${cid}`}
            </div>
            <Badge tone={toneByCasePriority(caseRow.priority)}>
              {cleanLabel(caseRow.priority || "Medium")}
            </Badge>
            <Badge tone={toneByCaseStatus(status)}>{cleanLabel(status || "Open")}</Badge>
          </div>
          <div className="mt-2 text-sm text-black/75 dark:text-white/80">
            {caseRow.title || "Untitled case"}
          </div>
          <div className="mt-1 text-xs text-black/50 dark:text-white/50">
            Store {caseRow.store_id || "-"} · Assigned to {assigned}
            {caseRow.alert_id ? ` · Alert #${caseRow.alert_id}` : ""}
          </div>
        </div>

        <div className="text-right text-xs text-black/45 dark:text-white/45">
          <div>Updated</div>
          <div className="mt-0.5 text-black/65 dark:text-white/65">
            {formatDateTime(caseRow.updated_at)}
          </div>
        </div>
      </div>

      {caseRow.description ? (
        <div className="mt-3 rounded border border-white/10 bg-black/10 px-3 py-2 text-xs text-black/60 dark:text-white/60">
          {caseRow.description}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {isAdmin ? (
          <IconButton
            icon={UserPlus}
            tone="blue"
            onClick={() => onAssign(caseRow)}
            disabled={actingId === actionIdAssign}
          >
            {actingId === actionIdAssign ? "Assigning" : "Assign to Me"}
          </IconButton>
        ) : null}

        {isAdmin && status === "OPEN" ? (
          <IconButton
            onClick={() => onStatus(caseRow, "IN_PROGRESS")}
            disabled={actingId === actionIdStatus}
          >
            {actingId === actionIdStatus ? "Updating" : "Start"}
          </IconButton>
        ) : null}

        {isAdmin && (status === "OPEN" || status === "IN_PROGRESS") ? (
          <IconButton
            icon={CheckCircle2}
            tone="green"
            onClick={() => onStatus(caseRow, "RESOLVED")}
            disabled={actingId === actionIdStatus}
          >
            {actingId === actionIdStatus ? "Updating" : "Resolve"}
          </IconButton>
        ) : null}

        {isAdmin && status === "RESOLVED" ? (
          <IconButton
            onClick={() => onStatus(caseRow, "OPEN")}
            disabled={actingId === actionIdStatus}
          >
            {actingId === actionIdStatus ? "Updating" : "Reopen"}
          </IconButton>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={noteDraft}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Add a short follow-up note"
          className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-black/80 outline-none placeholder:text-black/35 focus:border-cyan-500/50 dark:text-white/80 dark:placeholder:text-white/35"
        />
        <IconButton
          icon={MessageSquare}
          onClick={() => onAddNote(caseRow)}
          disabled={actingId === actionIdNote || !String(noteDraft || "").trim()}
        >
          {actingId === actionIdNote ? "Adding" : "Add Note"}
        </IconButton>
      </div>
    </div>
  );
}
