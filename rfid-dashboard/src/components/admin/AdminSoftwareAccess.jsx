import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function normalizeCompanyName(rawValue) {
  return String(rawValue || "").trim();
}

function buildUserDrafts(users = []) {
  const drafts = {};
  users.forEach((user) => {
    drafts[user.id] = Array.from(
      new Set(
        (Array.isArray(user?.product_keys) ? user.product_keys : [])
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
  });
  return drafts;
}

function summarizeRoles(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const labels = Array.from(
    new Set(
      roles
        .map((row) => String(row?.role || "").trim())
        .filter(Boolean)
    )
  );
  return labels.join(", ") || "No role";
}

function userCanOpenPortal(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((row) => {
    const role = String(row?.role || "").trim().toUpperCase();
    return role === "MASTER_ADMIN" || role === "ADMIN";
  });
}

function productTone(productKey) {
  switch (productKey) {
    case "portal":
      return "border-purple-500/35 bg-purple-500/8 text-purple-200";
    case "laundry":
      return "border-cyan-500/35 bg-cyan-500/8 text-cyan-100";
    case "stock_audit":
      return "border-amber-500/35 bg-amber-500/8 text-amber-100";
    default:
      return "border-blue-500/35 bg-blue-500/8 text-blue-100";
  }
}

export default function AdminSoftwareAccess() {
  const { isMasterAdmin, user } = useAuth();
  const scopedCompany = normalizeCompanyName(user?.company_name);

  const [companyOptions, setCompanyOptions] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(() =>
    isMasterAdmin ? "" : scopedCompany
  );
  const [catalog, setCatalog] = useState([]);
  const [companyProducts, setCompanyProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [userDrafts, setUserDrafts] = useState({});
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingUserId, setSavingUserId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const companyCatalog = useMemo(
    () => (Array.isArray(catalog) ? catalog : []).filter((item) => item?.company_assignable),
    [catalog]
  );

  const userCatalog = useMemo(
    () =>
      (Array.isArray(catalog) ? catalog : [])
        .filter((item) => item?.user_assignable)
        .filter((item) => isMasterAdmin || item?.key !== "portal"),
    [catalog, isMasterAdmin]
  );

  const loadCompanyOptions = useCallback(async () => {
    if (!isMasterAdmin) {
      const nextOptions = scopedCompany ? [scopedCompany] : [];
      setCompanyOptions(nextOptions);
      setSelectedCompany(scopedCompany);
      setLoadingCompanies(false);
      return;
    }

    try {
      setLoadingCompanies(true);
      const [usersRes, storesRes] = await Promise.all([
        apiGet("/admin/users"),
        apiGet("/admin/stores"),
      ]);

      const companies = new Set();
      (Array.isArray(usersRes?.users) ? usersRes.users : []).forEach((row) => {
        const companyName = normalizeCompanyName(row?.company_name);
        if (companyName) companies.add(companyName);
      });
      (Array.isArray(storesRes?.stores) ? storesRes.stores : []).forEach((row) => {
        const companyName = normalizeCompanyName(row?.company_name);
        if (companyName) companies.add(companyName);
      });

      const nextOptions = Array.from(companies).sort((a, b) => a.localeCompare(b));
      setCompanyOptions(nextOptions);
      setSelectedCompany((prev) => {
        if (prev && nextOptions.includes(prev)) return prev;
        return nextOptions[0] || "";
      });
    } catch (e) {
      console.error("[admin/software] load companies failed", e);
      setError("Failed to load customer companies");
      setCompanyOptions([]);
      setSelectedCompany("");
    } finally {
      setLoadingCompanies(false);
    }
  }, [isMasterAdmin, scopedCompany]);

  const loadSoftwareAccess = useCallback(
    async (companyName) => {
      const targetCompany = isMasterAdmin
        ? normalizeCompanyName(companyName)
        : scopedCompany;

      if (!targetCompany) {
        setCatalog([]);
        setCompanyProducts([]);
        setUsers([]);
        setUserDrafts({});
        return;
      }

      try {
        setLoadingAccess(true);
        const query = isMasterAdmin
          ? `?company_name=${encodeURIComponent(targetCompany)}`
          : "";
        const res = await apiGet(`/admin/software-access${query}`);

        const nextCatalog = Array.isArray(res?.catalog) ? res.catalog : [];
        const nextUsers = Array.isArray(res?.users) ? res.users : [];
        const nextProducts = Array.from(
          new Set(
            (Array.isArray(res?.company_products) ? res.company_products : [])
              .map((value) => String(value || "").trim().toLowerCase())
              .filter(Boolean)
          )
        );

        setCatalog(nextCatalog);
        setCompanyProducts(nextProducts);
        setUsers(nextUsers);
        setUserDrafts(buildUserDrafts(nextUsers));
      } catch (e) {
        console.error("[admin/software] load access failed", e);
        setError(e?.error || e?.message || "Failed to load software access");
        setCatalog([]);
        setCompanyProducts([]);
        setUsers([]);
        setUserDrafts({});
      } finally {
        setLoadingAccess(false);
      }
    },
    [isMasterAdmin, scopedCompany]
  );

  useEffect(() => {
    loadCompanyOptions();
  }, [loadCompanyOptions]);

  useEffect(() => {
    if (!selectedCompany && isMasterAdmin) return;
    loadSoftwareAccess(selectedCompany);
  }, [selectedCompany, isMasterAdmin, loadSoftwareAccess]);

  function toggleCompanyProduct(productKey) {
    setCompanyProducts((prev) => {
      if (prev.includes(productKey)) {
        return prev.filter((item) => item !== productKey);
      }
      return [...prev, productKey].sort((a, b) => a.localeCompare(b));
    });
  }

  function toggleUserProduct(userId, productKey) {
    setUserDrafts((prev) => {
      const current = Array.isArray(prev[userId]) ? prev[userId] : [];
      const next = current.includes(productKey)
        ? current.filter((item) => item !== productKey)
        : [...current, productKey].sort((a, b) => a.localeCompare(b));

      return {
        ...prev,
        [userId]: next,
      };
    });
  }

  async function saveCompanyProducts() {
    if (!selectedCompany) {
      setError("Select a customer first");
      return;
    }

    try {
      setSavingCompany(true);
      setError("");
      setSuccess("");

      await apiPut(
        `/admin/software-access/company/${encodeURIComponent(selectedCompany)}`,
        { products: companyProducts }
      );

      setSuccess(`Saved purchased software for ${selectedCompany}`);
      await loadSoftwareAccess(selectedCompany);
    } catch (e) {
      console.error("[admin/software] save company products failed", e);
      setError(e?.error || e?.message || "Failed to save company software");
    } finally {
      setSavingCompany(false);
    }
  }

  async function saveUserProducts(targetUser) {
    try {
      setSavingUserId(targetUser.id);
      setError("");
      setSuccess("");

      await apiPut(`/admin/software-access/users/${targetUser.id}`, {
        products: userDrafts[targetUser.id] || [],
      });

      setSuccess(`Saved software access for ${targetUser.email}`);
      await loadSoftwareAccess(selectedCompany);
    } catch (e) {
      console.error("[admin/software] save user products failed", e);
      setError(e?.error || e?.message || "Failed to save user software");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Software Access</h2>
            <p className="mt-1 text-sm text-white/65">
              Choose what each customer purchased, then decide which Xandora software each login
              is allowed to open.
            </p>
          </div>

          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/6 px-4 py-3 text-xs text-cyan-100/90">
            Retail, Laundry, and Stock Audit stay separate now. A user only gets into the
            software selected on this screen and chosen at login.
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-sm text-green-300">
            {success}
          </div>
        )}
      </div>

      <div className="glass rounded-xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Customer Software</h3>
            <p className="mt-1 text-sm text-white/60">
              Purchased software controls what can be assigned to users in that customer account.
            </p>
          </div>

          {isMasterAdmin ? (
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-white/60" htmlFor="software-company">
                Customer
              </label>
              <select
                id="software-company"
                className="min-w-[220px] rounded border border-white/15 bg-black/35 px-3 py-2 text-sm text-white"
                value={selectedCompany}
                onChange={(e) => {
                  setError("");
                  setSuccess("");
                  setSelectedCompany(e.target.value);
                }}
                disabled={loadingCompanies}
              >
                {!companyOptions.length ? (
                  <option value="">
                    {loadingCompanies ? "Loading customers..." : "No customers found"}
                  </option>
                ) : (
                  companyOptions.map((companyName) => (
                    <option key={companyName} value={companyName}>
                      {companyName}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : (
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
              {selectedCompany || "No company assigned"}
            </div>
          )}
        </div>

        {!selectedCompany ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
            Select a customer to manage purchased software.
          </div>
        ) : loadingAccess ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
            Loading software access...
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">{selectedCompany}</div>
                  <p className="mt-1 text-xs text-white/55">
                    Turn on the software this customer has purchased. Users can only be assigned to
                    software enabled here.
                  </p>
                </div>

                {isMasterAdmin && (
                  <button
                    type="button"
                    onClick={saveCompanyProducts}
                    disabled={savingCompany}
                    className="rounded-lg border border-cyan-500/45 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/10 disabled:opacity-60"
                  >
                    {savingCompany ? "Saving..." : "Save Customer Software"}
                  </button>
                )}
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {companyCatalog.map((product) => {
                  const checked = companyProducts.includes(product.key);
                  return (
                    <label
                      key={product.key}
                      className={[
                        "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition",
                        checked
                          ? productTone(product.key)
                          : "border-white/10 bg-white/5 text-white/75 hover:bg-white/8",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={checked}
                        onChange={() => toggleCompanyProduct(product.key)}
                        disabled={!isMasterAdmin || savingCompany}
                      />
                      <div>
                        <div className="text-sm font-medium">{product.label}</div>
                        <div className="mt-1 text-xs opacity-75">
                          {product.key === "retail"
                            ? "POS, stock visibility, alerts, and device workflows."
                            : product.key === "laundry"
                            ? "Fabric lifecycle, wash cycles, intake, dispatch, and return tracking."
                            : "Count control, scan verification, discrepancy review, and stocktake workflows."}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div>
                <h4 className="text-sm font-semibold text-white">User Product Access</h4>
                <p className="mt-1 text-xs text-white/55">
                  Give each user access only to the Xandora software they should open. Portal is
                  reserved for admin accounts.
                </p>
              </div>

              {!users.length ? (
                <div className="mt-5 rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
                  No users found for this customer yet.
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {users.map((row) => (
                    <UserAccessCard
                      key={row.id}
                      user={row}
                      catalog={userCatalog}
                      selectedProducts={userDrafts[row.id] || []}
                      companyProducts={companyProducts}
                      saving={savingUserId === row.id}
                      onToggle={toggleUserProduct}
                      onSave={saveUserProducts}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserAccessCard({
  user,
  catalog,
  selectedProducts,
  companyProducts,
  saving,
  onToggle,
  onSave,
}) {
  const companyProductSet = new Set(
    (Array.isArray(companyProducts) ? companyProducts : []).map((value) =>
      String(value || "").trim().toLowerCase()
    )
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-white">{user.email}</div>
          <div className="mt-1 text-xs text-white/55">
            {summarizeRoles(user)}
            {" · "}
            {user.is_active === false ? "Disabled" : "Active"}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSave(user)}
          disabled={saving}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/85 transition hover:bg-white/8 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Access"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {catalog.map((product) => {
          const allowed =
            product.key === "portal"
              ? userCanOpenPortal(user)
              : companyProductSet.has(product.key);
          const checked = allowed && selectedProducts.includes(product.key);

          return (
            <label
              key={`${user.id}-${product.key}`}
              className={[
                "rounded-xl border px-4 py-3 transition",
                checked
                  ? productTone(product.key)
                  : allowed
                  ? "cursor-pointer border-white/10 bg-white/5 text-white/75 hover:bg-white/8"
                  : "cursor-not-allowed border-white/8 bg-black/20 text-white/35",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={checked}
                  disabled={!allowed || saving}
                  onChange={() => onToggle(user.id, product.key)}
                />
                <div>
                  <div className="text-sm font-medium">{product.label}</div>
                  <div className="mt-1 text-xs opacity-75">
                    {!allowed
                      ? product.key === "portal"
                        ? "Portal can only be assigned to admin accounts."
                        : "Enable this software for the customer first."
                      : "User can sign in to this software when selected on login."}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
