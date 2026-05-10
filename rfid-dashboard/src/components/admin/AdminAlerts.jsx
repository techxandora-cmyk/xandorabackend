import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function normalizeCompanyView(raw) {
  const value = String(raw || "").trim();
  const upper = value.toUpperCase();
  if (
    !value ||
    upper === "GLOBAL" ||
    upper === "GLOBAL_VIEW" ||
    upper === "GLOBAL VIEW" ||
    upper === "XANDORA"
  ) {
    return "";
  }
  return value;
}

function isCustomerCompany(raw) {
  const value = String(raw || "").trim();
  return Boolean(value) && value.toUpperCase() !== "XANDORA";
}

function hasRole(user, expectedRole) {
  const target = String(expectedRole || "").trim().toUpperCase();
  const rows = Array.isArray(user?.roles) ? user.roles : [];
  return rows.some(
    (row) => String(row?.role || "").trim().toUpperCase() === target
  );
}

function assignedStoreCount(user) {
  const rows = Array.isArray(user?.roles) ? user.roles : [];
  return new Set(
    rows
      .map((row) => String(row?.store_id || "").trim())
      .filter((storeId) => Boolean(storeId) && storeId !== "_GLOBAL_")
  ).size;
}

function severityWeight(level) {
  const s = String(level || "").toUpperCase();
  if (s === "CRITICAL") return 4;
  if (s === "HIGH") return 3;
  if (s === "MEDIUM") return 2;
  return 1;
}

function toDateOnly(value) {
  return String(value || "").trim().slice(0, 10);
}

function dateDiffFromToday(dateOnly) {
  const value = toDateOnly(dateOnly);
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const now = new Date();
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((ms - todayMs) / 86400000);
}

function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDateTime(value) {
  if (!value) return "--";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return "--";
  return new Date(ms).toLocaleString();
}

function formatMoney(amount, currencyCode = "LKR") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "--";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currencyCode || "LKR").toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${String(currencyCode || "LKR").toUpperCase()} ${n.toFixed(2)}`;
  }
}

function buildCompanyOptions(users, stores, profiles, paymentAlerts = []) {
  const companies = new Set();
  users.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  stores.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  profiles.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  paymentAlerts.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  return Array.from(companies).sort((a, b) => a.localeCompare(b));
}

function createPaymentNoticeForm() {
  return {
    title: "Payment Due Reminder",
    message: "",
    severity: "HIGH",
    due_date: "",
    amount: "",
    currency_code: "LKR",
    block_on_due: false,
  };
}

function paymentNoticePayload(form, companyName) {
  const textOrNull = (v) => {
    const text = String(v || "").trim();
    return text || null;
  };
  const numberOrNull = (v) => {
    const text = String(v || "").trim();
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };

  return {
    company_name: String(companyName || "").trim(),
    title: textOrNull(form.title) || "Payment Due Reminder",
    message: textOrNull(form.message),
    severity: String(form.severity || "HIGH").trim().toUpperCase(),
    due_date: textOrNull(form.due_date),
    amount: numberOrNull(form.amount),
    currency_code: String(form.currency_code || "LKR").trim().toUpperCase(),
    block_on_due: Boolean(form.block_on_due),
  };
}

function buildMasterAlerts(users, stores, billingProfiles, paymentAlerts, selectedScope = "") {
  const byCompany = new Map();
  const ensure = (rawCompany) => {
    const company = String(rawCompany || "").trim();
    if (!isCustomerCompany(company)) return null;
    if (!byCompany.has(company)) {
      byCompany.set(company, {
        company_name: company,
        users: [],
        stores: [],
        billing: null,
        payment_alerts: [],
      });
    }
    return byCompany.get(company);
  };

  users.forEach((user) => {
    const row = ensure(user?.company_name);
    if (!row || hasRole(user, "MASTER_ADMIN")) return;
    row.users.push(user);
  });
  stores.forEach((store) => {
    const row = ensure(store?.company_name);
    if (row) row.stores.push(store);
  });
  billingProfiles.forEach((profile) => {
    const row = ensure(profile?.company_name);
    if (row) row.billing = profile;
  });
  paymentAlerts.forEach((notice) => {
    const row = ensure(notice?.company_name);
    if (row) row.payment_alerts.push(notice);
  });

  const rows = Array.from(byCompany.values())
    .filter((row) => (selectedScope ? row.company_name === selectedScope : true))
    .sort((a, b) => a.company_name.localeCompare(b.company_name));

  let seq = 1;
  const alerts = [];

  rows.forEach((row) => {
    const usersTotal = row.users.length;
    const activeAdmins = row.users.filter(
      (u) => hasRole(u, "ADMIN") && u?.is_active !== false
    );
    const adminsWithoutStores = activeAdmins.filter(
      (u) => assignedStoreCount(u) === 0
    );
    const storesTotal = row.stores.length;
    const activeStores = row.stores.filter((s) => s?.is_active);
    const inactiveStores = row.stores.filter((s) => !s?.is_active);
    const latestStoreUpdate = row.stores
      .map((s) => String(s?.updated_at || ""))
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

    if (activeAdmins.length === 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "NO_ACTIVE_ADMIN",
        company_name: row.company_name,
        severity: "CRITICAL",
        status: "OPEN",
        detail: "No active admin account found.",
        updated_at: latestStoreUpdate || null,
      });
    }
    if (storesTotal === 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "NO_STORES",
        company_name: row.company_name,
        severity: "HIGH",
        status: "OPEN",
        detail: "No stores configured.",
        updated_at: null,
      });
    } else if (activeStores.length === 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "ALL_STORES_INACTIVE",
        company_name: row.company_name,
        severity: "HIGH",
        status: "OPEN",
        detail: `All ${storesTotal} stores are inactive.`,
        updated_at: latestStoreUpdate || null,
      });
    }
    if (inactiveStores.length > 0 && activeStores.length > 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "INACTIVE_STORES_PRESENT",
        company_name: row.company_name,
        severity: "MEDIUM",
        status: "OPEN",
        detail: `${inactiveStores.length} inactive store(s) need review.`,
        updated_at: latestStoreUpdate || null,
      });
    }
    if (adminsWithoutStores.length > 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "ADMIN_SCOPE_GAP",
        company_name: row.company_name,
        severity: "MEDIUM",
        status: "OPEN",
        detail: `${adminsWithoutStores.length} admin(s) without store assignment.`,
        updated_at: latestStoreUpdate || null,
      });
    }
    if (usersTotal > 0 && storesTotal === 0) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "USERS_WITHOUT_STORE_INFRA",
        company_name: row.company_name,
        severity: "HIGH",
        status: "OPEN",
        detail: `${usersTotal} user(s) exist but no stores are configured.`,
        updated_at: null,
      });
    }

    const profile = row.billing;
    if (!profile) {
      alerts.push({
        id: `cust-${seq++}`,
        type: "BILLING_PROFILE_MISSING",
        company_name: row.company_name,
        severity: "MEDIUM",
        status: "OPEN",
        detail: "Billing profile missing (fees, due date, bank details).",
        updated_at: null,
      });
    } else {
      const currency = String(profile.currency_code || "LKR").toUpperCase();
      const overdue = toAmount(profile.overdue_amount);
      const outstanding = toAmount(profile.outstanding_amount);
      const isOverdue = Boolean(profile.is_overdue) || overdue > 0;
      const dueIn = dateDiffFromToday(profile.next_due_date);
      const contractEndIn = dateDiffFromToday(profile.contract_end_date);

      if (isOverdue) {
        alerts.push({
          id: `cust-${seq++}`,
          type: "PAYMENT_OVERDUE",
          company_name: row.company_name,
          severity: "CRITICAL",
          status: "OPEN",
          detail: `Overdue ${formatMoney(overdue || outstanding, currency)}.`,
          updated_at: profile.updated_at || null,
        });
      } else if (dueIn !== null && dueIn >= 0 && dueIn <= 7 && outstanding > 0) {
        alerts.push({
          id: `cust-${seq++}`,
          type: "PAYMENT_DUE_SOON",
          company_name: row.company_name,
          severity: dueIn <= 2 ? "HIGH" : "MEDIUM",
          status: "OPEN",
          detail: `${formatMoney(outstanding, currency)} due in ${dueIn} day(s).`,
          updated_at: profile.updated_at || null,
        });
      }

      if (contractEndIn !== null && contractEndIn >= 0 && contractEndIn <= 60) {
        alerts.push({
          id: `cust-${seq++}`,
          type: "CONTRACT_EXPIRING_SOON",
          company_name: row.company_name,
          severity: contractEndIn <= 30 ? "HIGH" : "MEDIUM",
          status: "OPEN",
          detail: `Contract expires in ${contractEndIn} day(s) (${toDateOnly(profile.contract_end_date)}).`,
          updated_at: profile.updated_at || null,
        });
      }
    }

    row.payment_alerts
      .filter((notice) => String(notice?.status || "").toUpperCase() === "OPEN")
      .forEach((notice) => {
        const dueIn = dateDiffFromToday(notice?.due_date);
        const blockingNow =
          Boolean(notice?.is_blocking_now) ||
          (Boolean(notice?.block_on_due) && dueIn !== null && dueIn <= 0);
        const dueDate = toDateOnly(notice?.due_date);
        const amountText =
          notice?.amount != null
            ? ` ${formatMoney(notice.amount, notice.currency_code || "LKR")}`
            : "";

        alerts.push({
          id: `payment-${notice.id}`,
          row_id: notice.id,
          source_kind: "PAYMENT_ALERT",
          type: blockingNow ? "ACCOUNT_BLOCKED_DUE_PAYMENT" : "CUSTOMER_PAYMENT_NOTICE_OPEN",
          company_name: row.company_name,
          severity: blockingNow
            ? "CRITICAL"
            : String(notice?.severity || "MEDIUM").toUpperCase(),
          status: "OPEN",
          detail: `${String(notice?.title || "Payment Reminder")}: ${String(
            notice?.message || ""
          )}${amountText}${dueDate ? ` (due ${dueDate})` : ""}${
            notice?.block_on_due ? " [auto-block ON]" : ""
          }`,
          updated_at: notice?.created_at || notice?.updated_at || null,
        });
      });
  });

  return alerts.sort((a, b) => {
    const bySeverity = severityWeight(String(b?.severity || "")) - severityWeight(String(a?.severity || ""));
    if (bySeverity !== 0) return bySeverity;
    const bTime = Date.parse(String(b?.updated_at || "")) || 0;
    const aTime = Date.parse(String(a?.updated_at || "")) || 0;
    return bTime - aTime;
  });
}

export default function AdminAlerts() {
  const { isMasterAdmin } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scope, setScope] = useState(() =>
    normalizeCompanyView(localStorage.getItem("xandora_company_view") || "")
  );
  const [customerCompanies, setCustomerCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [sendingPaymentNotice, setSendingPaymentNotice] = useState(false);
  const [paymentNoticeForm, setPaymentNoticeForm] = useState(() =>
    createPaymentNoticeForm()
  );

  const scopeLabel = useMemo(() => (scope ? scope : "All customers"), [scope]);

  async function loadAlerts(silent = false) {
    if (!silent) setLoading(true);
    setError("");

    try {
      if (isMasterAdmin) {
        const [usersRes, storesRes, billingRes, paymentAlertsRes] = await Promise.all([
          apiGet("/admin/users"),
          apiGet("/admin/stores?include_inactive=1"),
          apiGet("/admin/customer-billing-profiles"),
          apiGet("/admin/customer-payment-alerts?status=OPEN"),
        ]);

        const users = Array.isArray(usersRes?.users) ? usersRes.users : [];
        const stores = Array.isArray(storesRes?.stores) ? storesRes.stores : [];
        const billingProfiles = Array.isArray(billingRes?.profiles) ? billingRes.profiles : [];
        const paymentAlerts = Array.isArray(paymentAlertsRes?.alerts)
          ? paymentAlertsRes.alerts
          : [];

        const companies = buildCompanyOptions(users, stores, billingProfiles, paymentAlerts);
        setCustomerCompanies(companies);
        setSelectedCompany((previous) => {
          if (scope && companies.includes(scope)) return scope;
          if (previous && companies.includes(previous)) return previous;
          return companies[0] || "";
        });
        setAlerts(buildMasterAlerts(users, stores, billingProfiles, paymentAlerts, scope));
      } else {
        const [systemAlertsRes, paymentAlertsRes] = await Promise.all([
          apiGet("/alerts?status=OPEN"),
          apiGet("/admin/customer-payment-alerts?status=OPEN"),
        ]);

        const systemAlerts = Array.isArray(systemAlertsRes?.alerts)
          ? systemAlertsRes.alerts.map((row) => ({
              ...row,
              row_id: row.id,
              source_kind: "SYSTEM_ALERT",
              detail: row?.metadata?.summary || "",
            }))
          : [];

        const paymentNotices = Array.isArray(paymentAlertsRes?.alerts)
          ? paymentAlertsRes.alerts.map((row) => {
              const dueIn = dateDiffFromToday(row?.due_date);
              const blockingNow =
                Boolean(row?.is_blocking_now) ||
                (Boolean(row?.block_on_due) && dueIn !== null && dueIn <= 0);
              return {
                id: `payment-${row.id}`,
                row_id: row.id,
                source_kind: "PAYMENT_ALERT",
                type: blockingNow
                  ? "ACCOUNT_BLOCKED_DUE_PAYMENT"
                  : "PAYMENT_DUE_NOTICE",
                store_id: "ACCOUNT",
                severity: String(row?.severity || "MEDIUM").toUpperCase(),
                status: row?.status || "OPEN",
                detail: `${String(row?.title || "Payment Reminder")}: ${String(
                  row?.message || ""
                )}${
                  row?.amount != null
                    ? ` ${formatMoney(row.amount, row.currency_code || "LKR")}`
                    : ""
                }${row?.due_date ? ` (due ${toDateOnly(row.due_date)})` : ""}${
                  row?.block_on_due ? " [auto-block ON]" : ""
                }`,
                updated_at: row?.updated_at || row?.created_at || null,
              };
            })
          : [];

        setAlerts(
          [...paymentNotices, ...systemAlerts].sort((a, b) => {
            const bySeverity =
              severityWeight(String(b?.severity || "")) -
              severityWeight(String(a?.severity || ""));
            if (bySeverity !== 0) return bySeverity;
            const bTime = Date.parse(String(b?.updated_at || "")) || 0;
            const aTime = Date.parse(String(a?.updated_at || "")) || 0;
            return bTime - aTime;
          })
        );
      }
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to load alerts");
      setAlerts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    function syncScope() {
      const next = normalizeCompanyView(localStorage.getItem("xandora_company_view") || "");
      setScope((prev) => (prev === next ? prev : next));
    }

    window.addEventListener("storage", syncScope);
    window.addEventListener("xandora_company_view_changed", syncScope);
    return () => {
      window.removeEventListener("storage", syncScope);
      window.removeEventListener("xandora_company_view_changed", syncScope);
    };
  }, []);

  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMasterAdmin, scope]);

  async function sendPaymentNotice(event) {
    event.preventDefault();
    if (!isMasterAdmin) return;

    const companyName = String(selectedCompany || "").trim();
    if (!companyName) {
      setError("Select a customer company first.");
      return;
    }

    setSendingPaymentNotice(true);
    setError("");
    setSuccess("");

    try {
      await apiPost(
        "/admin/customer-payment-alerts",
        paymentNoticePayload(paymentNoticeForm, companyName)
      );
      setSuccess(`Payment alert sent to ${companyName}.`);
      setPaymentNoticeForm(createPaymentNoticeForm());
      await loadAlerts(true);
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to send payment alert");
    } finally {
      setSendingPaymentNotice(false);
    }
  }

  async function resolveAlert(alertRow) {
    if (!alertRow) return;
    setActingId(alertRow.id);
    setError("");
    setSuccess("");

    try {
      if (alertRow.source_kind === "PAYMENT_ALERT") {
        await apiPost(`/admin/customer-payment-alerts/${alertRow.row_id}/resolve`, {});
        setSuccess(isMasterAdmin ? "Payment alert revoked." : "Payment alert resolved.");
      } else if (!isMasterAdmin) {
        await apiPut(`/alerts/${alertRow.row_id || alertRow.id}/resolve`, {});
        setSuccess(`Alert #${alertRow.row_id || alertRow.id} resolved`);
      }
      await loadAlerts(true);
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to resolve alert");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">
          {isMasterAdmin ? "Customer Account Alerts" : "Active Alerts"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">
            {alerts.length} {isMasterAdmin ? "issues" : "active"}
          </span>
          {isMasterAdmin ? (
            <span className="text-xs rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-cyan-300">
              Scope: {scopeLabel}
            </span>
          ) : null}
          <button onClick={() => loadAlerts()} className="px-3 py-1 text-xs rounded border">
            Refresh
          </button>
        </div>
      </div>

      {isMasterAdmin ? (
        <form
          onSubmit={sendPaymentNotice}
          className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-amber-300">Send Customer Payment Alert</h3>
              <p className="text-xs text-white/70 mt-1">
                Send due reminders and optionally auto-block account access when due date is passed.
              </p>
            </div>
            <div className="text-xs text-white/70">
              Target: <span className="text-amber-200">{selectedCompany || "No customer selected"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-xs space-y-1">
              <span className="opacity-70">Customer</span>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              >
                <option value="">Select company</option>
                {customerCompanies.map((companyName) => (
                  <option key={companyName} value={companyName}>
                    {companyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs space-y-1 md:col-span-2">
              <span className="opacity-70">Alert Title</span>
              <input
                type="text"
                value={paymentNoticeForm.title}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({ ...prev, title: e.target.value }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="opacity-70">Severity</span>
              <select
                value={paymentNoticeForm.severity}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({ ...prev, severity: e.target.value }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span className="opacity-70">Due Date</span>
              <input
                type="date"
                value={paymentNoticeForm.due_date}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({ ...prev, due_date: e.target.value }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="opacity-70">Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentNoticeForm.amount}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({ ...prev, amount: e.target.value }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="opacity-70">Currency</span>
              <input
                type="text"
                maxLength={8}
                value={paymentNoticeForm.currency_code}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({
                    ...prev,
                    currency_code: e.target.value.toUpperCase(),
                  }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block text-xs space-y-1">
            <span className="opacity-70">Alert Message</span>
            <textarea
              rows={3}
              value={paymentNoticeForm.message}
              onChange={(e) =>
                setPaymentNoticeForm((prev) => ({ ...prev, message: e.target.value }))
              }
              placeholder="Example: Your monthly payment is due in 5 days. Please complete transfer to avoid service interruption."
              className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs opacity-80">
              <input
                type="checkbox"
                checked={Boolean(paymentNoticeForm.block_on_due)}
                onChange={(e) =>
                  setPaymentNoticeForm((prev) => ({
                    ...prev,
                    block_on_due: e.target.checked,
                  }))
                }
              />
              Auto-block account on due date if alert stays open
            </label>
            <button
              type="submit"
              disabled={sendingPaymentNotice}
              className="px-4 py-2 rounded border border-amber-400/40 bg-amber-500/10 text-amber-200 text-sm disabled:opacity-50"
            >
              {sendingPaymentNotice ? "Sending..." : "Send Payment Alert"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="mb-3 text-sm text-red-400">{error}</div> : null}
      {success ? <div className="mb-3 text-sm text-green-400">{success}</div> : null}

      {loading ? (
        <div className="text-sm opacity-70">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="text-sm opacity-70">
          {isMasterAdmin ? "No customer account issues detected." : "No active alerts"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-70">
                <th className="py-2">Type</th>
                {isMasterAdmin ? <th className="py-2">Company</th> : <th className="py-2">Store</th>}
                <th className="py-2">Severity</th>
                <th className="py-2">Status</th>
                <th className="py-2">Details</th>
                <th className="py-2">Updated / Action</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((row) => {
                const paymentNoticeOpen =
                  row.source_kind === "PAYMENT_ALERT" &&
                  String(row.status || "").toUpperCase() === "OPEN";
                const systemAlertOpen =
                  row.source_kind !== "PAYMENT_ALERT" &&
                  String(row.status || "").toUpperCase() === "OPEN";
                const canAct = paymentNoticeOpen || (!isMasterAdmin && systemAlertOpen);

                return (
                  <tr key={row.id} className="border-t border-white/10">
                    <td className="py-2">{row.type}</td>
                    {isMasterAdmin ? (
                      <td className="py-2">{row.company_name || "Unassigned"}</td>
                    ) : (
                      <td className="py-2">{row.store_id || "GLOBAL"}</td>
                    )}
                    <td className="py-2">{row.severity}</td>
                    <td className="py-2 capitalize">{row.status}</td>
                    <td className="py-2">{row.detail || "-"}</td>
                    <td className="py-2">
                      {canAct ? (
                        <button
                          disabled={actingId === row.id}
                          onClick={() => resolveAlert(row)}
                          className="px-2 py-1 text-xs rounded border disabled:opacity-50"
                        >
                          {actingId === row.id
                            ? "Processing..."
                            : paymentNoticeOpen && isMasterAdmin
                            ? "Revoke"
                            : "Resolve"}
                        </button>
                      ) : (
                        formatDateTime(row.updated_at)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
