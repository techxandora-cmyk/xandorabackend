import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const CONTRACT_FIELDS = [
  { key: "contract_years", label: "Contract Years", type: "number", min: 1, max: 50 },
  { key: "contract_start_date", label: "Contract Start", type: "date" },
  { key: "next_due_date", label: "Next Due Date", type: "date" },
  { key: "annual_license_fee", label: "Annual License Fee", type: "number", min: 0, step: "0.01" },
  { key: "monthly_fee", label: "Monthly Fee", type: "number", min: 0, step: "0.01" },
  { key: "outstanding_amount", label: "Outstanding", type: "number", min: 0, step: "0.01" },
  { key: "overdue_amount", label: "Overdue", type: "number", min: 0, step: "0.01" },
  { key: "currency_code", label: "Currency", type: "text", maxLength: 8 },
  { key: "bank_name", label: "Bank Name", type: "text" },
  { key: "bank_branch", label: "Bank Branch", type: "text" },
  { key: "bank_account_name", label: "Bank Account Name", type: "text" },
  { key: "bank_account_number", label: "Bank Account Number", type: "text" },
  { key: "billing_contact_name", label: "Billing Contact", type: "text" },
  { key: "billing_contact_email", label: "Billing Email", type: "email" },
  { key: "billing_contact_phone", label: "Billing Phone", type: "text" },
];

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

function toDateOnly(value) {
  return String(value || "").trim().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "--";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return "--";
  return new Date(ms).toLocaleString();
}

function buildCompanyOptions(users, stores, profiles) {
  const companies = new Set();
  users.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  stores.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  profiles.forEach((row) => isCustomerCompany(row?.company_name) && companies.add(String(row.company_name).trim()));
  return Array.from(companies).sort((a, b) => a.localeCompare(b));
}

function createEmptyForm(companyName = "") {
  return {
    company_name: companyName,
    contract_years: "",
    contract_start_date: "",
    annual_license_fee: "",
    monthly_fee: "",
    outstanding_amount: "",
    overdue_amount: "",
    next_due_date: "",
    currency_code: "LKR",
    bank_name: "",
    bank_branch: "",
    bank_account_name: "",
    bank_account_number: "",
    billing_contact_name: "",
    billing_contact_email: "",
    billing_contact_phone: "",
    payment_notes: "",
    is_active: true,
  };
}

function formFromProfile(profile, companyName = "") {
  if (!profile) return createEmptyForm(companyName);
  return {
    company_name: String(profile.company_name || companyName || ""),
    contract_years: profile.contract_years == null ? "" : String(profile.contract_years),
    contract_start_date: toDateOnly(profile.contract_start_date),
    annual_license_fee: profile.annual_license_fee == null ? "" : String(profile.annual_license_fee),
    monthly_fee: profile.monthly_fee == null ? "" : String(profile.monthly_fee),
    outstanding_amount: profile.outstanding_amount == null ? "" : String(profile.outstanding_amount),
    overdue_amount: profile.overdue_amount == null ? "" : String(profile.overdue_amount),
    next_due_date: toDateOnly(profile.next_due_date),
    currency_code: String(profile.currency_code || "LKR").toUpperCase(),
    bank_name: String(profile.bank_name || ""),
    bank_branch: String(profile.bank_branch || ""),
    bank_account_name: String(profile.bank_account_name || ""),
    bank_account_number: String(profile.bank_account_number || ""),
    billing_contact_name: String(profile.billing_contact_name || ""),
    billing_contact_email: String(profile.billing_contact_email || ""),
    billing_contact_phone: String(profile.billing_contact_phone || ""),
    payment_notes: String(profile.payment_notes || ""),
    is_active: profile.is_active !== false,
  };
}

function payloadFromForm(form) {
  const textOrNull = (value) => {
    const text = String(value || "").trim();
    return text || null;
  };
  const numberOrNull = (value) => {
    const text = String(value || "").trim();
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  };

  return {
    company_name: String(form.company_name || "").trim(),
    contract_years: numberOrNull(form.contract_years),
    contract_start_date: textOrNull(form.contract_start_date),
    annual_license_fee: numberOrNull(form.annual_license_fee),
    monthly_fee: numberOrNull(form.monthly_fee),
    outstanding_amount: numberOrNull(form.outstanding_amount),
    overdue_amount: numberOrNull(form.overdue_amount),
    next_due_date: textOrNull(form.next_due_date),
    currency_code: String(form.currency_code || "LKR").trim().toUpperCase(),
    bank_name: textOrNull(form.bank_name),
    bank_branch: textOrNull(form.bank_branch),
    bank_account_name: textOrNull(form.bank_account_name),
    bank_account_number: textOrNull(form.bank_account_number),
    billing_contact_name: textOrNull(form.billing_contact_name),
    billing_contact_email: textOrNull(form.billing_contact_email),
    billing_contact_phone: textOrNull(form.billing_contact_phone),
    payment_notes: textOrNull(form.payment_notes),
    is_active: Boolean(form.is_active),
  };
}

export default function AdminContracts() {
  const { isMasterAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scope, setScope] = useState(() =>
    normalizeCompanyView(localStorage.getItem("zyro_company_view") || "")
  );
  const [profiles, setProfiles] = useState([]);
  const [customerCompanies, setCustomerCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [form, setForm] = useState(createEmptyForm());

  const profilesByCompany = useMemo(
    () =>
      new Map(
        (Array.isArray(profiles) ? profiles : []).map((row) => [
          String(row?.company_name || "").trim(),
          row,
        ])
      ),
    [profiles]
  );

  const selectedProfile = useMemo(
    () => (selectedCompany ? profilesByCompany.get(selectedCompany) || null : null),
    [profilesByCompany, selectedCompany]
  );

  async function loadContracts(silent = false) {
    if (!isMasterAdmin) {
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError("");

    try {
      const [usersRes, storesRes, profilesRes] = await Promise.all([
        apiGet("/admin/users"),
        apiGet("/admin/stores?include_inactive=1"),
        apiGet("/admin/customer-billing-profiles"),
      ]);

      const users = Array.isArray(usersRes?.users) ? usersRes.users : [];
      const stores = Array.isArray(storesRes?.stores) ? storesRes.stores : [];
      const nextProfiles = Array.isArray(profilesRes?.profiles)
        ? profilesRes.profiles
        : [];
      const companies = buildCompanyOptions(users, stores, nextProfiles);

      setProfiles(nextProfiles);
      setCustomerCompanies(companies);
      setSelectedCompany((previous) => {
        if (scope && companies.includes(scope)) return scope;
        if (previous && companies.includes(previous)) return previous;
        return companies[0] || "";
      });
      setSuccess("");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to load billing contracts");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    function syncScope() {
      const next = normalizeCompanyView(localStorage.getItem("zyro_company_view") || "");
      setScope((prev) => (prev === next ? prev : next));
    }

    window.addEventListener("storage", syncScope);
    window.addEventListener("zyro_company_view_changed", syncScope);
    return () => {
      window.removeEventListener("storage", syncScope);
      window.removeEventListener("zyro_company_view_changed", syncScope);
    };
  }, []);

  useEffect(() => {
    loadContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMasterAdmin, scope]);

  useEffect(() => {
    setForm(formFromProfile(selectedProfile, selectedCompany));
  }, [selectedCompany, selectedProfile]);

  async function saveContract(event) {
    event.preventDefault();
    if (!isMasterAdmin) return;

    const companyName = String(selectedCompany || "").trim();
    if (!companyName) {
      setError("Select a customer company before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await apiPut(
        `/admin/customer-billing-profiles/${encodeURIComponent(companyName)}`,
        payloadFromForm({ ...form, company_name: companyName })
      );
      setSuccess(`Saved billing contract for ${companyName}.`);
      await loadContracts(true);
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to save billing contract");
    } finally {
      setSaving(false);
    }
  }

  if (!isMasterAdmin) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        Only Master Admin can manage billing contracts.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm opacity-70">Loading billing contracts...</div>;
  }

  return (
    <div className="glass p-6 rounded-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Billing & Contract Profiles</h2>
          <p className="text-xs text-white/60 mt-1">
            Customer payment terms, fee structure, bank details, and contract cycle.
          </p>
        </div>
        {selectedProfile ? (
          <div className="text-right text-xs text-white/65">
            <div>Last updated: {formatDateTime(selectedProfile.updated_at)}</div>
            <div>
              Status:{" "}
              {selectedProfile.is_overdue ? (
                <span className="text-red-300">Overdue</span>
              ) : (
                <span className="text-emerald-300">Normal</span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="text-sm text-red-400">{error}</div> : null}
      {success ? <div className="text-sm text-green-400">{success}</div> : null}

      <form
        onSubmit={saveContract}
        className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs space-y-1">
            <span className="opacity-70">Customer Company</span>
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

          {CONTRACT_FIELDS.map((field) => (
            <label key={field.key} className="text-xs space-y-1">
              <span className="opacity-70">{field.label}</span>
              <input
                type={field.type}
                min={field.min}
                max={field.max}
                step={field.step}
                maxLength={field.maxLength}
                value={form[field.key] ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]:
                      field.key === "currency_code"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  }))
                }
                className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
              />
            </label>
          ))}
        </div>

        <label className="block text-xs space-y-1">
          <span className="opacity-70">Payment / Contract Notes</span>
          <textarea
            rows={3}
            value={form.payment_notes}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, payment_notes: e.target.value }))
            }
            className="w-full rounded border border-white/15 bg-black/30 px-2 py-2 text-sm"
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs opacity-80">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, is_active: e.target.checked }))
              }
            />
            Billing profile active
          </label>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Billing Details"}
          </button>
        </div>
      </form>
    </div>
  );
}
