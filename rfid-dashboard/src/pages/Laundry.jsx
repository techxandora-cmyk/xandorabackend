import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const PAGE_TABS = [
  {
    value: "dashboard",
    label: "Dashboard",
    kicker: "Command view",
    title: "See stock, wash flow, watchlist, and recent activity.",
    summary: "High-level visibility for supervisors and decision makers.",
  },
  {
    value: "inbound",
    label: "Inbound",
    kicker: "Wash in",
    title: "Receive and move fabrics into the wash flow.",
    summary: "Use this workspace for intake, return-to-stock, and wash-floor handoff.",
  },
  {
    value: "outbound",
    label: "Outbound",
    kicker: "Wash out",
    title: "Complete washing, dispatch out, and close the loop.",
    summary: "Use this workspace for wash completion, dispatch, and exception handling.",
  },
  {
    value: "data_entry",
    label: "Data Entry",
    kicker: "Master data",
    title: "Build the fabric master directly inside Xandora.",
    summary: "Use this when the customer wants to maintain data in-app.",
  },
];

const INBOUND_ACTIONS = [
  ["receive", "Receive Back", "Bring returned fabrics back into tracked stock."],
  ["wash_start", "Send to Wash", "Mark a scanned batch as entering the wash floor."],
  ["audit", "Audit Scan", "Verify scanned fabrics without changing status."],
];

const OUTBOUND_ACTIONS = [
  ["wash_complete", "Complete Wash", "Close the batch and increment cycle counts."],
  ["checkout", "Dispatch Out", "Move scanned fabrics out to a room, route, or customer."],
  ["mark_damaged", "Mark Damaged", "Flag scanned fabrics for review or replacement."],
  ["mark_lost", "Mark Lost", "Capture shrinkage as soon as it happens."],
  ["retire", "Retire Item", "Remove end-of-life fabrics from active use."],
];

const STATUS_OPTIONS = [
  ["ALL", "All statuses"],
  ["IN_STOCK", "In stock"],
  ["OUT_WITH_CUSTOMER", "Out with customer"],
  ["IN_WASH", "In wash"],
  ["DAMAGED", "Damaged"],
  ["LOST", "Lost"],
  ["RETIRED", "Retired"],
];

const OPTION_CLASS = "bg-slate-100 text-slate-900";

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function when(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function labelize(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeTag(value) {
  return String(value || "").trim().toUpperCase();
}

function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function pillTone(value, type = "status") {
  const key = String(value || "").toUpperCase();
  if (type === "lifecycle") {
    if (key === "EXCEEDED") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    if (key === "NEAR_LIMIT") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (key === "IN_STOCK") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (key === "OUT_WITH_CUSTOMER") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (key === "IN_WASH") return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  if (key === "DAMAGED") return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  if (key === "LOST") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (key === "RETIRED") return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300";
  return "border-white/15 bg-white/5 text-white/80";
}

function Card({ title, subtitle, actions = null, children, accent = false }) {
  return (
    <section
      className={`rounded-[28px] border p-5 ${
        accent
          ? "border-cyan-500/20 bg-[linear-gradient(180deg,rgba(11,28,46,0.92),rgba(9,18,30,0.88))]"
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

function Metric({ title, value, detail, tone = "" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone || "border-white/10 bg-white/[0.03]"}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">{title}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{num(value).toLocaleString()}</div>
      <div className="mt-2 text-sm text-white/72">{detail}</div>
    </div>
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

export default function Laundry({ view = "dashboard" }) {
  const { hasPermission, isAdmin, isMasterAdmin } = useAuth();
  const canManage = isAdmin || isMasterAdmin || hasPermission("dashboard.manage_laundry");

  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("xandora_store_id") || "STORE_001"
  );
  const [filters, setFilters] = useState({ q: "", status: "ALL" });
  const [draft, setDraft] = useState({ q: "", status: "ALL" });
  const [summary, setSummary] = useState(null);
  const [itemTypes, setItemTypes] = useState([]);
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [typeForm, setTypeForm] = useState({
    name: "",
    code: "",
    category: "FABRICS",
    fabric_type: "",
    size_label: "",
    unit_price: "",
    max_wash_cycles: "200",
    warning_cycle_threshold: "180",
    notes: "",
  });
  const [registerForm, setRegisterForm] = useState({
    epc: "",
    item_type_id: "",
    item_name: "",
    fabric_type: "",
    size_label: "",
    unit_price: "",
    current_location: "Main laundry store",
    assigned_to: "",
    max_wash_cycles: "",
    warning_cycle_threshold: "",
    notes: "",
  });
  const [inboundForm, setInboundForm] = useState({
    action: "receive",
    location_label: "Laundry intake",
    assigned_to: "",
    reference_no: "",
    notes: "",
    cycle_increment: "",
  });
  const [outboundForm, setOutboundForm] = useState({
    action: "wash_complete",
    location_label: "Laundry dispatch",
    assigned_to: "",
    reference_no: "",
    notes: "",
    cycle_increment: "",
  });
  const [scanInput, setScanInput] = useState("");
  const [scannedEpcs, setScannedEpcs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const scanInputRef = useRef(null);

  const selectedTab = PAGE_TABS.find((tab) => tab.value === view) || PAGE_TABS[0];
  const actionOptions =
    view === "inbound" ? INBOUND_ACTIONS : view === "outbound" ? OUTBOUND_ACTIONS : [];
  const activeForm = view === "outbound" ? outboundForm : inboundForm;
  const selectedAction =
    actionOptions.find(([value]) => value === activeForm.action) || actionOptions[0] || null;

  const loadLaundry = useCallback(async () => {
    const sid = String(storeId || "").trim();
    if (!sid) {
      setError("Select a customer store before using Xandora Laundry.");
      setSummary(null);
      setItemTypes([]);
      setItems([]);
      setEvents([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ store_id: sid, limit: "200" });
      if (filters.q) params.set("q", filters.q);
      if (filters.status !== "ALL") params.set("status", filters.status);

      const [summaryRes, typesRes, itemsRes, eventsRes] = await Promise.all([
        apiGet(`/laundry/summary?store_id=${encodeURIComponent(sid)}`),
        apiGet(`/laundry/item-types?store_id=${encodeURIComponent(sid)}`),
        apiGet(`/laundry/items?${params.toString()}`),
        apiGet(`/laundry/events?store_id=${encodeURIComponent(sid)}&limit=20`),
      ]);

      setSummary(summaryRes?.summary || null);
      setItemTypes(Array.isArray(typesRes?.item_types) ? typesRes.item_types : []);
      setItems(Array.isArray(itemsRes?.items) ? itemsRes.items : []);
      setEvents(Array.isArray(eventsRes?.events) ? eventsRes.events : []);
    } catch (e) {
      console.error("[Laundry] load failed:", e);
      setError(
        e?.status === 404
          ? "Laundry API route not found. Restart the backend and retry."
          : e?.error || e?.message || "Failed to load Xandora Laundry"
      );
      setSummary(null);
      setItemTypes([]);
      setItems([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.status, storeId]);

  useEffect(() => {
    loadLaundry();
  }, [loadLaundry]);

  useEffect(() => {
    function onStoreChanged() {
      setStoreId(localStorage.getItem("xandora_store_id") || "");
    }
    window.addEventListener("xandora_store_changed", onStoreChanged);
    return () => window.removeEventListener("xandora_store_changed", onStoreChanged);
  }, []);

  useEffect(() => {
    if (!registerForm.item_type_id && itemTypes.length) {
      const firstType = itemTypes[0];
      setRegisterForm((prev) => ({
        ...prev,
        item_type_id: String(firstType.id),
        item_name: firstType.name || "",
        fabric_type: firstType.fabric_type || firstType.category || "",
        size_label: firstType.size_label || "",
        unit_price:
          firstType.unit_price === null || firstType.unit_price === undefined
            ? ""
            : String(firstType.unit_price),
        max_wash_cycles: firstType.max_wash_cycles ? String(firstType.max_wash_cycles) : "",
        warning_cycle_threshold: firstType.warning_cycle_threshold
          ? String(firstType.warning_cycle_threshold)
          : "",
      }));
    }
  }, [itemTypes, registerForm.item_type_id]);

  useEffect(() => {
    setScanInput("");
    setScannedEpcs([]);
    if (view === "inbound") {
      setInboundForm((prev) => ({
        ...prev,
        action: INBOUND_ACTIONS.some(([value]) => value === prev.action)
          ? prev.action
          : "receive",
      }));
    }
    if (view === "outbound") {
      setOutboundForm((prev) => ({
        ...prev,
        action: OUTBOUND_ACTIONS.some(([value]) => value === prev.action)
          ? prev.action
          : "wash_complete",
      }));
    }
  }, [view]);

  useEffect(() => {
    if (view === "inbound" || view === "outbound") {
      scanInputRef.current?.focus();
    }
  }, [view, activeForm.action]);

  const riskItems = useMemo(
    () =>
      items
        .filter((item) => {
          const lifecycle = String(item?.lifecycle_state || "").toUpperCase();
          const status = String(item?.status || "").toUpperCase();
          return (
            lifecycle === "NEAR_LIMIT" ||
            lifecycle === "EXCEEDED" ||
            ["DAMAGED", "LOST", "RETIRED"].includes(status)
          );
        })
        .slice(0, 6),
    [items]
  );

  const attentionCount =
    num(summary?.nearing_end_of_life) +
    num(summary?.damaged_items) +
    num(summary?.lost_items) +
    num(summary?.exceeded_cycles);

  const catalogValueEstimate = useMemo(
    () =>
      itemTypes.reduce(
        (total, type) => total + num(type.unit_price) * Math.max(num(type.asset_count), 0),
        0
      ),
    [itemTypes]
  );

  const recentEvents = useMemo(() => events.slice(0, 6), [events]);
  const dashboardTypePreview = useMemo(() => itemTypes.slice(0, 4), [itemTypes]);

  function applyTypeDefaults(nextTypeId) {
    const nextType = itemTypes.find((type) => String(type.id) === String(nextTypeId));
    setRegisterForm((prev) => ({
      ...prev,
      item_type_id: String(nextTypeId || ""),
      item_name: nextType?.name || prev.item_name,
      fabric_type: nextType?.fabric_type || nextType?.category || prev.fabric_type,
      size_label: nextType?.size_label || "",
      unit_price:
        nextType?.unit_price === null || nextType?.unit_price === undefined
          ? ""
          : String(nextType.unit_price),
      max_wash_cycles: nextType?.max_wash_cycles ? String(nextType.max_wash_cycles) : "",
      warning_cycle_threshold: nextType?.warning_cycle_threshold
        ? String(nextType.warning_cycle_threshold)
        : "",
    }));
  }

  function updateActionForm(field, value) {
    if (view === "outbound") {
      setOutboundForm((prev) => ({ ...prev, [field]: value }));
      return;
    }
    setInboundForm((prev) => ({ ...prev, [field]: value }));
  }

  function resetScanQueue() {
    setScanInput("");
    setScannedEpcs([]);
    scanInputRef.current?.focus();
  }

  function handleScanEnter(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const normalized = normalizeTag(scanInput);
    if (normalized) {
      setScannedEpcs((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
      setScanInput("");
      setMessage("");
      return;
    }

    if (scannedEpcs.length > 0 && !saving) {
      executeAction();
    }
  }

  async function saveType(e) {
    e.preventDefault();
    setSaving("type");
    setError("");
    setMessage("");
    try {
      await apiPost("/laundry/item-types", { store_id: storeId, ...typeForm });
      setTypeForm({
        name: "",
        code: "",
        category: "FABRICS",
        fabric_type: "",
        size_label: "",
        unit_price: "",
        max_wash_cycles: "200",
        warning_cycle_threshold: "180",
        notes: "",
      });
      setMessage("Fabric type created.");
      await loadLaundry();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to create fabric type");
    } finally {
      setSaving("");
    }
  }

  async function registerItem(e) {
    e.preventDefault();
    setSaving("register");
    setError("");
    setMessage("");
    try {
      await apiPost("/laundry/items/register", {
        store_id: storeId,
        ...registerForm,
        item_type_id: Number(registerForm.item_type_id),
      });
      setRegisterForm((prev) => ({
        ...prev,
        epc: "",
        current_location: "Main laundry store",
        assigned_to: "",
        notes: "",
      }));
      setMessage("Tagged fabric registered.");
      await loadLaundry();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to register tagged fabric");
    } finally {
      setSaving("");
    }
  }

  async function executeAction() {
    if (!selectedAction) return;
    if (!scannedEpcs.length) {
      setError("Scan at least one fabric tag before running the action.");
      return;
    }

    setSaving("action");
    setError("");
    setMessage("");
    try {
      const res = await apiPost("/laundry/actions", {
        store_id: storeId,
        ...activeForm,
        action: selectedAction[0],
        epcs: scannedEpcs,
      });
      setMessage(
        `${num(res?.processed)} fabric item${num(res?.processed) === 1 ? "" : "s"} updated.`
      );
      resetScanQueue();
      await loadLaundry();
    } catch (err) {
      setError(err?.error || err?.message || "Failed to apply fabric action");
    } finally {
      setSaving("");
    }
  }

  function applyFilters(e) {
    e.preventDefault();
    const next = {
      q: String(draft.q || "").trim(),
      status: String(draft.status || "ALL").toUpperCase(),
    };
    setFilters(next);
    if (next.q === filters.q && next.status === filters.status) loadLaundry();
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <section className="laundry-hero rounded-[32px] border border-cyan-500/18 px-6 py-6 shadow-[0_26px_64px_rgba(3,10,20,0.28)]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                Xandora Laundry
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                Lifecycle control
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                Straightforward operations
              </span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              Fabric lifecycle control without the clutter.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/78">
              Supervisors get a clean dashboard. Scanning staff get focused inbound and
              outbound workspaces. Master data stays separate so the main operation does
              not feel stacked or crowded.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Metric title="Ready stock" value={summary?.in_stock} detail="Available for issue." />
              <Metric title="Out in use" value={summary?.out_with_customer} detail="Currently off-site or assigned." />
              <Metric title="In wash" value={summary?.in_wash} detail="Still inside wash processing." />
              <Metric
                title="Needs attention"
                value={attentionCount}
                detail="Near limit, damaged, lost, or exceeded."
                tone={attentionCount ? "border-amber-500/25 bg-amber-500/6" : ""}
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/12 bg-black/20 p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Store scope</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {storeId || "No store selected"}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/72">
              This workspace stays scoped to the selected customer store.
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Metric title="Fabric types" value={summary?.item_types} detail="Reusable master definitions." />
              <Metric title="Avg cycles" value={summary?.avg_wash_cycles} detail="Average age of active fabrics." />
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">
                Catalog value
              </div>
              <div className="mt-2 text-lg font-semibold text-white">
                {money(catalogValueEstimate)}
              </div>
              <div className="mt-1 text-sm text-white/72">
                Based on optional unit prices saved against fabric types.
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      ) : null}

      <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
          {selectedTab.kicker}
        </div>
        <div className="mt-1 text-lg font-semibold text-white">{selectedTab.title}</div>
        <div className="mt-1 text-sm text-white/72">{selectedTab.summary}</div>
      </div>

      {view === "dashboard" && (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <Card
              title="Operations Snapshot"
              subtitle="A cleaner supervisor view of stock, wash flow, and policy pressure."
              accent
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Metric title="Tagged fabrics" value={summary?.total_items} detail="Total tracked fabric assets." />
                <Metric title="In stock" value={summary?.in_stock} detail="Ready to issue." />
                <Metric title="Out with customer" value={summary?.out_with_customer} detail="Currently in use." />
                <Metric title="In wash" value={summary?.in_wash} detail="Active wash batches." />
                <Metric title="Near limit" value={summary?.nearing_end_of_life} detail="Needs replacement planning." tone={num(summary?.nearing_end_of_life) ? "border-amber-500/25 bg-amber-500/6" : ""} />
                <Metric title="Exceeded cycles" value={summary?.exceeded_cycles} detail="Already beyond policy." tone={num(summary?.exceeded_cycles) ? "border-rose-500/25 bg-rose-500/6" : ""} />
              </div>
            </Card>

            <Card
              title="Lifecycle Watchlist"
              subtitle="Priority items to recover, replace, or review before the next batch."
            >
              {riskItems.length === 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-200">
                  No urgent lifecycle issues in the current result set.
                </div>
              ) : (
                <div className="space-y-3">
                  {riskItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {item.item_name || item.type_name || item.epc}
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-cyan-200">{item.epc}</div>
                        </div>
                        <div className="flex gap-2">
                          <Pill tone={pillTone(item.status)}>{labelize(item.status)}</Pill>
                          <Pill tone={pillTone(item.lifecycle_state, "lifecycle")}>
                            {labelize(item.lifecycle_state || "OK")}
                          </Pill>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm text-white/72 sm:grid-cols-2">
                        <div><span className="text-white/55">Fabric:</span> {item.fabric_type || item.item_category || "-"}</div>
                        <div><span className="text-white/55">Size:</span> {item.size_label || "-"}</div>
                        <div><span className="text-white/55">Cycles:</span> {num(item.wash_cycle_count)} / {num(item.max_wash_cycles)}</div>
                        <div><span className="text-white/55">Location:</span> {item.current_location || "-"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
            <Card
              title="Tracked Fabric Assets"
              subtitle="Search by EPC, fabric type, size, location, or assigned destination."
              actions={
                <form onSubmit={applyFilters} className="flex flex-wrap gap-2">
                  <input value={draft.q} onChange={(e) => setDraft((prev) => ({ ...prev, q: e.target.value }))} placeholder="Search EPC or asset details" className="min-w-[220px] rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/45" />
                  <select value={draft.status} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))} className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
                    {STATUS_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value} className={OPTION_CLASS}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={loading} className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-60">
                    {loading ? "Loading..." : "Apply"}
                  </button>
                </form>
              }
            >
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-white/65">
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left font-medium">Asset</th>
                      <th className="px-3 py-3 text-left font-medium">Fabric</th>
                      <th className="px-3 py-3 text-left font-medium">Size</th>
                      <th className="px-3 py-3 text-left font-medium">Status</th>
                      <th className="px-3 py-3 text-left font-medium">Cycles</th>
                      <th className="px-3 py-3 text-left font-medium">Price</th>
                      <th className="px-3 py-3 text-left font-medium">Placement</th>
                      <th className="px-3 py-3 text-left font-medium">Last event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-sm text-white/60">
                          {loading ? "Loading fabric assets..." : "No fabric items found for this store."}
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr key={item.id} className="border-b border-white/6 last:border-b-0 hover:bg-white/[0.03]">
                          <td className="px-3 py-4 align-top">
                            <div className="font-medium text-white">{item.item_name || item.type_name || "-"}</div>
                            <div className="mt-1 font-mono text-[11px] text-cyan-200">{item.epc}</div>
                          </td>
                          <td className="px-3 py-4 align-top text-white/78">{item.fabric_type || item.item_category || "-"}</td>
                          <td className="px-3 py-4 align-top text-white/78">{item.size_label || "-"}</td>
                          <td className="px-3 py-4 align-top">
                            <div className="flex flex-col gap-2">
                              <Pill tone={pillTone(item.status)}>{labelize(item.status)}</Pill>
                              <Pill tone={pillTone(item.lifecycle_state, "lifecycle")}>{labelize(item.lifecycle_state || "OK")}</Pill>
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top text-white/78">{num(item.wash_cycle_count)} / {num(item.max_wash_cycles)}</td>
                          <td className="px-3 py-4 align-top text-white/78">{money(item.unit_price)}</td>
                          <td className="px-3 py-4 align-top text-white/78">
                            <div>{item.current_location || "-"}</div>
                            <div className="mt-1 text-[11px] text-white/55">{item.assigned_to || "Unassigned"}</div>
                          </td>
                          <td className="px-3 py-4 align-top text-white/65">{when(item.last_event_at || item.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Recent Activity" subtitle="Latest lifecycle changes from scan activity and web actions.">
              {recentEvents.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">
                  No fabric events recorded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentEvents.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-semibold text-white">{labelize(row.event_type)}</div>
                      <div className="mt-1 text-sm text-white/72">{row.actor_email || "system"} · {when(row.created_at)}</div>
                      <div className="mt-3 text-sm text-white/72">
                        <span className="text-white/55">Item:</span> {row.item_name || row.item_category || "-"}
                      </div>
                      <div className="mt-1 text-sm text-white/72">
                        <span className="text-white/55">Cycle count:</span> {num(row.wash_cycle_after)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-6">
            <Card title="Fabric Type Overview" subtitle="A quick view of the main fabric definitions in the current store scope.">
              {dashboardTypePreview.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">
                  No fabric types configured yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {dashboardTypePreview.map((type) => (
                    <div key={type.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-semibold text-white">{type.name}</div>
                      <div className="mt-2 text-sm text-white/72">{type.fabric_type || "-"}</div>
                      <div className="mt-1 text-sm text-white/72">Size: {type.size_label || "-"}</div>
                      <div className="mt-1 text-sm text-white/72">Tagged: {num(type.asset_count)}</div>
                      <div className="mt-1 text-sm text-white/72">Policy: {num(type.max_wash_cycles)} / {num(type.warning_cycle_threshold)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {(view === "inbound" || view === "outbound") && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Card
            title={view === "inbound" ? "Inbound Scanner" : "Outbound Scanner"}
            subtitle="Scan tags one by one. The running total updates instantly. Press Enter on an empty scanner field to execute the selected action."
            accent
          >
            {canManage ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {actionOptions.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateActionForm("action", value)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        activeForm.action === value
                          ? "border-cyan-400/45 bg-cyan-500/10 text-cyan-200"
                          : "border-white/10 bg-white/5 text-white/78 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-sm font-semibold text-white">{selectedAction?.[1]}</div>
                  <div className="mt-1 text-sm leading-6 text-white/72">{selectedAction?.[2]}</div>
                </div>

                <div className="rounded-2xl border border-cyan-500/18 bg-cyan-500/6 p-4">
                  <label className="mb-2 block text-sm font-medium text-white">Scan tag</label>
                  <input
                    ref={scanInputRef}
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={handleScanEnter}
                    placeholder="Scan RFID tag and press Enter"
                    className="brand-input font-mono text-sm"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/82">
                      Total scanned: <span className="font-semibold text-cyan-200">{scannedEpcs.length}</span>
                    </div>
                    <div className="text-sm text-white/68">
                      Press Enter with an empty field to execute.
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <input value={activeForm.location_label} onChange={(e) => updateActionForm("location_label", e.target.value)} placeholder="Location label" className="brand-input" />
                  <input value={activeForm.assigned_to} onChange={(e) => updateActionForm("assigned_to", e.target.value)} placeholder={activeForm.action === "checkout" ? "Assigned customer / route / room" : "Assigned to"} className="brand-input" />
                  <input value={activeForm.reference_no} onChange={(e) => updateActionForm("reference_no", e.target.value)} placeholder="Reference number" className="brand-input" />
                  <input value={activeForm.cycle_increment} onChange={(e) => updateActionForm("cycle_increment", e.target.value)} placeholder="Optional cycle increment" className="brand-input" />
                </div>

                <textarea value={activeForm.notes} onChange={(e) => updateActionForm("notes", e.target.value)} placeholder="Action notes" rows={3} className="brand-input" />

                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={executeAction} disabled={saving === "action" || !scannedEpcs.length} className="brand-btn-primary px-5 py-2.5 text-sm disabled:opacity-60">
                    {saving === "action" ? "Processing..." : `Execute ${selectedAction?.[1] || "Action"}`}
                  </button>
                  <button type="button" onClick={resetScanQueue} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/82 hover:bg-white/10">
                    Clear Queue
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/72">
                This account is in view-only mode. Scanner execution is only available to users with Laundry management access.
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Scan Queue" subtitle="The scanned tags waiting to be executed.">
              {scannedEpcs.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">
                  No tags scanned yet.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-white/72">
                    {scannedEpcs.length} fabric item{scannedEpcs.length === 1 ? "" : "s"} ready for {selectedAction?.[1] || "action"}.
                  </div>
                  <div className="flex max-h-[320px] flex-wrap gap-2 overflow-auto">
                    {scannedEpcs.map((epc) => (
                      <button
                        key={epc}
                        type="button"
                        onClick={() => setScannedEpcs((prev) => prev.filter((value) => value !== epc))}
                        className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-200 hover:bg-cyan-500/15"
                        title="Remove from queue"
                      >
                        {epc}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card title="Recent Activity" subtitle="Latest wash and movement events in this store.">
              {recentEvents.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">
                  No fabric events recorded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentEvents.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-semibold text-white">{labelize(row.event_type)}</div>
                      <div className="mt-1 text-sm text-white/72">{row.item_name || row.item_category || "-"}</div>
                      <div className="mt-1 text-xs text-white/55">{when(row.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {view === "data_entry" && (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card
              title="Fabric Master"
              subtitle="Create reusable fabric definitions with size, pricing, and cycle policy."
              accent
            >
              {canManage ? (
                <form onSubmit={saveType} className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/72">
                    Use this area when the customer has no existing import file or wants to maintain the master directly in Xandora.
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <input value={typeForm.name} onChange={(e) => setTypeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Fabric type name" className="brand-input" />
                    <input value={typeForm.code} onChange={(e) => setTypeForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="Optional code" className="brand-input" />
                    <input value={typeForm.fabric_type} onChange={(e) => setTypeForm((prev) => ({ ...prev, fabric_type: e.target.value }))} placeholder="Fabric material or type" className="brand-input" />
                    <input value={typeForm.size_label} onChange={(e) => setTypeForm((prev) => ({ ...prev, size_label: e.target.value }))} placeholder="Size" className="brand-input" />
                    <input value={typeForm.unit_price} onChange={(e) => setTypeForm((prev) => ({ ...prev, unit_price: e.target.value }))} placeholder="Optional unit price" className="brand-input" />
                    <input value={typeForm.category} onChange={(e) => setTypeForm((prev) => ({ ...prev, category: e.target.value }))} placeholder="Category" className="brand-input" />
                    <input value={typeForm.max_wash_cycles} onChange={(e) => setTypeForm((prev) => ({ ...prev, max_wash_cycles: e.target.value }))} placeholder="Max wash cycles" className="brand-input" />
                    <input value={typeForm.warning_cycle_threshold} onChange={(e) => setTypeForm((prev) => ({ ...prev, warning_cycle_threshold: e.target.value }))} placeholder="Warning threshold" className="brand-input" />
                  </div>
                  <textarea value={typeForm.notes} onChange={(e) => setTypeForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" rows={3} className="brand-input" />
                  <button type="submit" disabled={saving === "type"} className="brand-btn-primary px-5 py-2.5 text-sm">
                    {saving === "type" ? "Saving..." : "Create Fabric Type"}
                  </button>
                </form>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/72">
                  This account is in view-only mode. Master data entry is only available to users with Laundry management access.
                </div>
              )}
            </Card>

            <Card
              title="Register Tagged Fabric"
              subtitle="Scan a tag, assign the fabric type, and create the tracked item in Xandora."
            >
              {canManage ? (
                <form onSubmit={registerItem} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <input value={registerForm.epc} onChange={(e) => setRegisterForm((prev) => ({ ...prev, epc: e.target.value }))} placeholder="Scan EPC / tag ID" className="brand-input font-mono" />
                    <select value={registerForm.item_type_id} onChange={(e) => applyTypeDefaults(e.target.value)} className="brand-input">
                      <option value="" className={OPTION_CLASS}>Select fabric type</option>
                      {itemTypes.map((type) => (
                        <option key={type.id} value={type.id} className={OPTION_CLASS}>
                          {type.name} ({type.code})
                        </option>
                      ))}
                    </select>
                    <input value={registerForm.item_name} onChange={(e) => setRegisterForm((prev) => ({ ...prev, item_name: e.target.value }))} placeholder="Display name" className="brand-input" />
                    <input value={registerForm.fabric_type} onChange={(e) => setRegisterForm((prev) => ({ ...prev, fabric_type: e.target.value }))} placeholder="Fabric material or type" className="brand-input" />
                    <input value={registerForm.size_label} onChange={(e) => setRegisterForm((prev) => ({ ...prev, size_label: e.target.value }))} placeholder="Size" className="brand-input" />
                    <input value={registerForm.unit_price} onChange={(e) => setRegisterForm((prev) => ({ ...prev, unit_price: e.target.value }))} placeholder="Optional unit price" className="brand-input" />
                    <input value={registerForm.current_location} onChange={(e) => setRegisterForm((prev) => ({ ...prev, current_location: e.target.value }))} placeholder="Current location" className="brand-input" />
                    <input value={registerForm.assigned_to} onChange={(e) => setRegisterForm((prev) => ({ ...prev, assigned_to: e.target.value }))} placeholder="Assigned customer / room / outlet" className="brand-input" />
                    <input value={registerForm.max_wash_cycles} onChange={(e) => setRegisterForm((prev) => ({ ...prev, max_wash_cycles: e.target.value }))} placeholder="Optional max cycles override" className="brand-input" />
                    <input value={registerForm.warning_cycle_threshold} onChange={(e) => setRegisterForm((prev) => ({ ...prev, warning_cycle_threshold: e.target.value }))} placeholder="Optional warning override" className="brand-input" />
                  </div>
                  <textarea value={registerForm.notes} onChange={(e) => setRegisterForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Registration notes" rows={3} className="brand-input" />
                  <button type="submit" disabled={saving === "register" || itemTypes.length === 0} className="brand-btn-primary px-5 py-2.5 text-sm">
                    {saving === "register" ? "Registering..." : "Register Tagged Fabric"}
                  </button>
                </form>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/72">
                  This account is in view-only mode. Registration is only available to users with Laundry management access.
                </div>
              )}
            </Card>
          </div>

          <div className="mt-6">
            <Card
              title="Fabric Type Library"
              subtitle="Lifecycle-ready templates that keep registration, pricing, and replenishment consistent."
            >
              {itemTypes.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">
                  No fabric types configured yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {itemTypes.map((type) => (
                    <div key={type.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{type.name}</div>
                          <div className="mt-1 font-mono text-[11px] text-cyan-200">{type.code || "-"}</div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/75">
                          {type.category || "FABRICS"}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-white/72">
                        <div><span className="text-white/55">Fabric:</span> {type.fabric_type || "-"}</div>
                        <div><span className="text-white/55">Size:</span> {type.size_label || "-"}</div>
                        <div><span className="text-white/55">Unit price:</span> {money(type.unit_price)}</div>
                        <div><span className="text-white/55">Tagged:</span> {num(type.asset_count)}</div>
                        <div><span className="text-white/55">Avg cycles:</span> {num(type.avg_wash_cycles).toFixed(1)}</div>
                        <div><span className="text-white/55">Policy:</span> {num(type.max_wash_cycles)} / {num(type.warning_cycle_threshold)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
