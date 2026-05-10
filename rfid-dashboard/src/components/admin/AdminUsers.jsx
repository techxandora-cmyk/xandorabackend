import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "STORE_MANAGER", label: "Store Manager" },
  { value: "STORE_STAFF", label: "Store Staff" },
  { value: "HANDHELD_USER", label: "Handheld User" },
];

const GLOBAL_ROLES = new Set(["MASTER_ADMIN", "GLOBAL_ADMIN", "ADMIN"]);
const PROTECTED_EMAILS = new Set(["admin@Xandora.local"]);

function getPrimaryRoleRow(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.find((r) => r && r.role) || null;
}

function isProtectedAccount(user) {
  const email = String(user?.email || "")
    .trim()
    .toLowerCase();
  const roles = (Array.isArray(user?.roles) ? user.roles : [])
    .map((r) => String(r?.role || "").toUpperCase());

  return PROTECTED_EMAILS.has(email) || roles.includes("MASTER_ADMIN");
}

function hasRole(user, role) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.some((r) => String(r?.role || "").toUpperCase() === role);
}

function normalizeCompanyName(value) {
  return String(value || "").trim();
}

function buildRoleDrafts(nextUsers) {
  const drafts = {};
  const allowedEditableRoles = new Set(ROLE_OPTIONS.map((r) => r.value));

  nextUsers.forEach((u) => {
    const roleRow = getPrimaryRoleRow(u);
    const rawRole = String(roleRow?.role || "STORE_MANAGER").toUpperCase();
    const role = allowedEditableRoles.has(rawRole)
      ? rawRole
      : "ADMIN";
    const isGlobal = GLOBAL_ROLES.has(role);

    drafts[u.id] = {
      role,
      store_id: isGlobal ? "" : String(roleRow?.store_id || "").trim(),
    };
  });

  return drafts;
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const { user, isMasterAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storesLoading, setStoresLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingRoleUserId, setSavingRoleUserId] = useState(null);
  const [resettingUserId, setResettingUserId] = useState(null);
  const [togglingUserId, setTogglingUserId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [storeOptions, setStoreOptions] = useState([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState("STORE_MANAGER");
  const [storeId, setStoreId] = useState("");
  const [company, setCompany] = useState("");

  const [roleDrafts, setRoleDrafts] = useState({});
  const [companyFilter, setCompanyFilter] = useState(
    () => localStorage.getItem("xandora_company_view") || ""
  );
  const [usersView, setUsersView] = useState("all");

  const [resetTargetId, setResetTargetId] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPwd, setShowResetPwd] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const scopedCompany = String(user?.company_name || "").trim();

  const loadStoreOptions = useCallback(async () => {
    try {
      setStoresLoading(true);
      const res = await apiGet("/admin/stores");
      const list = Array.isArray(res?.stores) ? res.stores : [];
      setStoreOptions(list);
    } catch (e) {
      console.error(e);
      setStoreOptions([]);
    } finally {
      setStoresLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await apiGet("/admin/users");
      const list = Array.isArray(res.users) ? res.users : [];
      setUsers(list);
      setRoleDrafts(buildRoleDrafts(list));
      if (!isMasterAdmin && !scopedCompany) {
        const me = list.find(
          (u) =>
            String(u?.email || "").toLowerCase() ===
            String(user?.email || "").toLowerCase()
        );
        setCompany(String(me?.company_name || ""));
      }
    } catch (e) {
      console.error(e);
      setError("Failed to load users");
      setUsers([]);
      setRoleDrafts({});
    } finally {
      setLoading(false);
    }
  }, [isMasterAdmin, scopedCompany, user?.email]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadStoreOptions();
  }, [loadStoreOptions]);

  useEffect(() => {
    function handleStoresUpdated() {
      loadStoreOptions();
    }

    window.addEventListener("xandora_stores_updated", handleStoresUpdated);
    return () => window.removeEventListener("xandora_stores_updated", handleStoresUpdated);
  }, [loadStoreOptions]);

  // Sync company filter when master admin switches company from the top-bar picker
  useEffect(() => {
    function syncCompanyFilter() {
      const cv = localStorage.getItem("xandora_company_view") || "";
      setCompanyFilter(cv);
    }
    window.addEventListener("xandora_company_view_changed", syncCompanyFilter);
    return () => window.removeEventListener("xandora_company_view_changed", syncCompanyFilter);
  }, []);

  useEffect(() => {
    if (!isMasterAdmin) {
      setCompany(scopedCompany);
    }
  }, [isMasterAdmin, scopedCompany]);

  const filteredUsers = useMemo(() => {
    let next = users;

    if (isMasterAdmin) {
      const q = companyFilter.trim().toLowerCase();
      if (q) {
        next = next.filter((u) =>
          String(u.company_name || "")
            .toLowerCase()
            .includes(q)
        );
      }
    }

    if (usersView === "handheld") {
      next = next.filter((u) => hasRole(u, "HANDHELD_USER"));
    }

    return next;
  }, [users, companyFilter, isMasterAdmin, usersView]);

  const handheldCount = useMemo(
    () => users.filter((u) => hasRole(u, "HANDHELD_USER")).length,
    [users]
  );

  const activeStoreOptions = useMemo(
    () =>
      (storeOptions || []).filter((s) => s && s.is_active !== false),
    [storeOptions]
  );

  const createCompanyName = normalizeCompanyName(
    isMasterAdmin ? company : scopedCompany
  );

  const createCompanyStores = useMemo(() => {
    if (!createCompanyName) return [];
    return activeStoreOptions
      .filter(
        (store) =>
          normalizeCompanyName(store?.company_name) === createCompanyName
      )
      .sort((a, b) =>
        String(a?.store_name || a?.store_id || "").localeCompare(
          String(b?.store_name || b?.store_id || "")
        )
      );
  }, [activeStoreOptions, createCompanyName]);

  const activeStoresByCompany = useMemo(() => {
    const map = {};
    activeStoreOptions.forEach((store) => {
      const companyName = normalizeCompanyName(store?.company_name);
      if (!companyName) return;

      if (!map[companyName]) {
        map[companyName] = [];
      }
      map[companyName].push(store);
    });

    Object.keys(map).forEach((companyName) => {
      map[companyName] = map[companyName].sort((a, b) =>
        String(a?.store_name || a?.store_id || "").localeCompare(
          String(b?.store_name || b?.store_id || "")
        )
      );
    });

    return map;
  }, [activeStoreOptions]);

  useEffect(() => {
    setRoleDrafts((prev) => {
      let changed = false;
      const next = { ...prev };

      users.forEach((u) => {
        const current = next[u.id];
        if (!current) return;

        const normalizedRole = String(current.role || "").toUpperCase();
        if (GLOBAL_ROLES.has(normalizedRole)) {
          if (current.store_id) {
            next[u.id] = { ...current, store_id: "" };
            changed = true;
          }
          return;
        }

        const companyName = normalizeCompanyName(u?.company_name);
        const companyStores = activeStoresByCompany[companyName] || [];
        const hasCurrentStore = companyStores.some(
          (store) => String(store.store_id) === String(current.store_id || "")
        );

        if (!hasCurrentStore) {
          next[u.id] = {
            ...current,
            store_id: companyStores[0]?.store_id || "",
          };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [users, activeStoresByCompany]);


  function updateRoleDraft(userId, patch) {
    setRoleDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || { role: "STORE_MANAGER", store_id: "" }),
        ...patch,
      },
    }));
  }

  useEffect(() => {
    if (GLOBAL_ROLES.has(role)) {
      if (storeId) setStoreId("");
      return;
    }

    if (!createCompanyStores.length) {
      if (storeId) setStoreId("");
      return;
    }

    if (!createCompanyStores.some((s) => s.store_id === storeId)) {
      setStoreId(String(createCompanyStores[0].store_id || ""));
    }
  }, [role, createCompanyStores, storeId]);

  async function createUser() {
    setError("");
    setSuccess("");

    const normalizedRole = String(role || "")
      .trim()
      .toUpperCase();
    const normalizedStore = GLOBAL_ROLES.has(normalizedRole)
      ? "_GLOBAL_"
      : String(storeId || "").trim();
    const effectiveCompany = isMasterAdmin ? company || null : scopedCompany || null;

    if (!email || !password || !normalizedRole) {
      setError("Email, password and role are required");
      return;
    }

    if (!effectiveCompany) {
      setError("Company is required");
      return;
    }

    if (!GLOBAL_ROLES.has(normalizedRole) && !normalizedStore) {
      setError("Store id is required for this role");
      return;
    }

    if (
      !GLOBAL_ROLES.has(normalizedRole) &&
      !createCompanyStores.some((s) => String(s.store_id) === normalizedStore)
    ) {
      setError("Select a valid active store for this company");
      return;
    }

    try {
      setCreating(true);

      await apiPost("/admin/users", {
        email: email.toLowerCase(),
        password,
        role: normalizedRole,
        store_id: normalizedStore,
        company_name: effectiveCompany,
      });

      setSuccess("User created. Next, assign software access in Admin > Software.");
      setEmail("");
      setPassword("");
      setCompany("");
      setRole("STORE_MANAGER");
      setStoreId("");
      if (!isMasterAdmin) {
        setCompany(scopedCompany);
      }

      await loadUsers();
    } catch (e) {
      console.error(e);
      if (String(e.message || "").toLowerCase().includes("exists")) {
        setError("User with this email already exists");
      } else {
        setError("Failed to create user");
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveUserRole(user) {
    const draft = roleDrafts[user.id];
    if (!draft?.role) {
      setError("Please select a role");
      return;
    }

    const normalizedRole = String(draft.role || "")
      .trim()
      .toUpperCase();
    const normalizedStore = GLOBAL_ROLES.has(normalizedRole)
      ? "_GLOBAL_"
      : String(draft.store_id || "").trim();
    const userCompanyName = normalizeCompanyName(user?.company_name);
    const userCompanyStores = activeStoresByCompany[userCompanyName] || [];

    if (!GLOBAL_ROLES.has(normalizedRole) && !normalizedStore) {
      setError("Store id is required for store roles");
      return;
    }

    if (
      !GLOBAL_ROLES.has(normalizedRole) &&
      !userCompanyStores.some((s) => String(s.store_id) === normalizedStore)
    ) {
      setError("Select a valid active store for this user's company");
      return;
    }

    try {
      setSavingRoleUserId(user.id);
      setError("");
      setSuccess("");

      await apiPut(`/admin/users/${user.id}/roles`, {
        role: normalizedRole,
        store_id: normalizedStore,
      });

      setSuccess(`Role updated for ${user.email}`);
      await loadUsers();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to update role");
    } finally {
      setSavingRoleUserId(null);
    }
  }

  function openResetPassword(user) {
    setResetTargetId(user.id);
    setResetPassword("");
    setShowResetPwd(false);
    setError("");
    setSuccess("");
  }

  function closeResetPassword() {
    setResetTargetId(null);
    setResetPassword("");
    setShowResetPwd(false);
  }

  async function submitResetPassword(user) {
    const nextPassword = String(resetPassword || "").trim();
    if (nextPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }

    try {
      setResettingUserId(user.id);
      setError("");
      setSuccess("");

      await apiPost(`/admin/users/${user.id}/reset-password`, {
        password: nextPassword,
      });

      setSuccess(`Password reset for ${user.email}`);
      closeResetPassword();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to reset password");
    } finally {
      setResettingUserId(null);
    }
  }

  async function toggleUser(user) {
    try {
      setTogglingUserId(user.id);
      setError("");
      setSuccess("");

      await apiPost(`/admin/users/${user.id}/status`, {
        is_active: !user.is_active,
      });

      setSuccess(`${user.email} ${user.is_active ? "disabled" : "enabled"}`);
      await loadUsers();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to update user status");
    } finally {
      setTogglingUserId(null);
    }
  }

  async function deleteUser(user) {
    const confirmDelete = window.confirm(
      `Delete user ${user.email}? This cannot be undone.`
    );
    if (!confirmDelete) return;

    try {
      setDeletingUserId(user.id);
      setError("");
      setSuccess("");

      await apiDelete(`/admin/users/${user.id}`);
      setSuccess(`Deleted ${user.email}`);

      if (resetTargetId === user.id) {
        closeResetPassword();
      }

      await loadUsers();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  }


  return (
    <div className="space-y-6">
      <div className="glass p-6 rounded-xl">
        <h2 className="text-lg font-semibold mb-3">Create New User</h2>

        {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
        {success && <div className="mb-3 text-sm text-green-400">{success}</div>}

        <div className="space-y-3">
          <input
            className="w-full px-3 py-2 rounded bg-black/40 border border-white/20"
            placeholder="Company Name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={!isMasterAdmin}
          />
          {!isMasterAdmin && (
            <p className="text-[11px] opacity-60">
              Company is locked to your admin scope.
            </p>
          )}

          <input
            className="w-full px-3 py-2 rounded bg-black/40 border border-white/20"
            placeholder="Email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              className="w-full px-3 py-2 rounded bg-black/40 border border-white/20 pr-16"
              placeholder="Password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-2 text-xs opacity-70"
            >
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>

          <div className="flex gap-2">
            <select
              className="px-3 py-2 rounded bg-black/40 border border-white/20"
              value={role}
              onChange={(e) => {
                const nextRole = e.target.value;
                setRole(nextRole);
                if (GLOBAL_ROLES.has(nextRole)) {
                  setStoreId("");
                } else if (createCompanyStores.length) {
                  setStoreId(String(createCompanyStores[0].store_id || ""));
                }
              }}
            >
              {ROLE_OPTIONS.filter((option) => isMasterAdmin || option.value !== "ADMIN").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {!GLOBAL_ROLES.has(role) && (
              <select
                className="px-3 py-2 rounded bg-black/40 border border-white/20 w-full sm:min-w-56"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={storesLoading || !createCompanyName || !createCompanyStores.length}
              >
                {!createCompanyName ? (
                  <option value="">Select company first</option>
                ) : storesLoading ? (
                  <option value="">Loading stores...</option>
                ) : !createCompanyStores.length ? (
                  <option value="">No active stores for company</option>
                ) : (
                  createCompanyStores.map((store) => (
                    <option key={store.store_id} value={store.store_id}>
                      {store.store_name || store.store_id} ({store.store_id})
                    </option>
                  ))
                )}
              </select>
            )}
          </div>

          <button
            onClick={createUser}
            disabled={creating}
            className="px-4 py-2 rounded bg-purple-600 text-white disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      <div className="glass p-6 rounded-xl">
        <div className="flex flex-wrap gap-3 justify-between items-end mb-4">
          <div>
            <h2 className="text-lg font-semibold">All Users</h2>
            <p className="text-xs opacity-70 mt-1">
              Showing {filteredUsers.length} of {users.length}
            </p>
            <p className="text-xs opacity-60 mt-1">
              Handheld users: {handheldCount}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setUsersView("all")}
              className={`px-3 py-1.5 text-xs rounded border ${
                usersView === "all" ? "bg-white/10" : ""
              }`}
            >
              All Users
            </button>
            <button
              onClick={() => setUsersView("handheld")}
              className={`px-3 py-1.5 text-xs rounded border ${
                usersView === "handheld" ? "bg-white/10" : ""
              }`}
            >
              Handheld Users
            </button>
            {isMasterAdmin && (
              <>
                <input
                  className="px-3 py-1.5 text-xs rounded bg-black/40 border border-white/20 w-full sm:min-w-52"
                  placeholder="Filter by company name"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                />
                <button
                  onClick={() => setCompanyFilter("")}
                  className="px-3 py-1.5 text-xs rounded border"
                >
                  Clear Filter
                </button>
              </>
            )}
            <button
              onClick={loadUsers}
              className="px-3 py-1.5 text-xs rounded border"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm opacity-60">Loading...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-sm opacity-60">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-white/10">
                  <th className="py-2">Email</th>
                  <th className="py-2">Company</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Store</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const draft = roleDrafts[u.id] || {
                    role: "STORE_MANAGER",
                    store_id: "",
                  };
                  const isGlobalDraft = GLOBAL_ROLES.has(draft.role);
                  const isProtected = isProtectedAccount(u);
                  const companyStores =
                    activeStoresByCompany[normalizeCompanyName(u?.company_name)] || [];

                  return (
                    <RoleRow
                      key={u.id}
                      user={u}
                      draft={draft}
                      companyStores={companyStores}
                      isGlobalDraft={isGlobalDraft}
                      isProtected={isProtected}
                      isMasterAdmin={isMasterAdmin}
                      onUpdateDraft={updateRoleDraft}
                      onSaveRole={saveUserRole}
                      onOpenReset={openResetPassword}
                      onToggleUser={toggleUser}
                      onDeleteUser={deleteUser}
                      savingRoleUserId={savingRoleUserId}
                      togglingUserId={togglingUserId}
                      deletingUserId={deletingUserId}
                      resetTargetId={resetTargetId}
                      resetPassword={resetPassword}
                      setResetPassword={setResetPassword}
                      showResetPwd={showResetPwd}
                      setShowResetPwd={setShowResetPwd}
                      submitResetPassword={submitResetPassword}
                      closeResetPassword={closeResetPassword}
                      resettingUserId={resettingUserId}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleRow({
  user,
  draft,
  companyStores,
  isGlobalDraft,
  isProtected,
  isMasterAdmin,
  onUpdateDraft,
  onSaveRole,
  onOpenReset,
  onToggleUser,
  onDeleteUser,
  savingRoleUserId,
  togglingUserId,
  deletingUserId,
  resetTargetId,
  resetPassword,
  setResetPassword,
  showResetPwd,
  setShowResetPwd,
  submitResetPassword,
  closeResetPassword,
  resettingUserId,
}) {
  const hasCompanyStores = Array.isArray(companyStores) && companyStores.length > 0;

  return (
    <>
      <tr
        className={`border-b border-white/5 ${
          user.is_active === false ? "opacity-40" : ""
        }`}
      >
        <td className="py-2">{user.email}</td>
        <td className="py-2">{user.company_name || "-"}</td>
        <td className="py-2">
          {isProtected ? (
            <span className="opacity-80">Master Admin</span>
          ) : (
            <select
              className="px-2 py-1 rounded bg-black/40 border border-white/20"
              value={draft.role}
              onChange={(e) => {
                const nextRole = e.target.value;
                onUpdateDraft(user.id, {
                  role: nextRole,
                  store_id: GLOBAL_ROLES.has(nextRole)
                    ? ""
                    : hasCompanyStores
                    ? draft.store_id || String(companyStores[0].store_id || "")
                    : "",
                });
              }}
            >
              {ROLE_OPTIONS.filter((option) => isMasterAdmin || option.value !== "ADMIN").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="py-2">
          {isGlobalDraft ? (
            <span className="opacity-70">Global</span>
          ) : (
            <select
              className="px-2 py-1 rounded bg-black/40 border border-white/20 w-full lg:min-w-56"
              value={draft.store_id}
              disabled={isProtected || !hasCompanyStores}
              onChange={(e) =>
                onUpdateDraft(user.id, { store_id: e.target.value })
              }
            >
              {!hasCompanyStores ? (
                <option value="">No active stores</option>
              ) : (
                companyStores.map((store) => (
                  <option key={store.store_id} value={store.store_id}>
                    {store.store_name || store.store_id} ({store.store_id})
                  </option>
                ))
              )}
            </select>
          )}
        </td>
        <td className="py-2">
          {user.is_active ? (
            <span className="text-green-400">Active</span>
          ) : (
            <span className="text-red-400">Disabled</span>
          )}
        </td>
        <td className="py-2">
          {isProtected ? (
            <span className="text-[11px] opacity-70">
              Protected account
            </span>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => onSaveRole(user)}
                disabled={savingRoleUserId === user.id}
                className="text-xs underline disabled:opacity-60"
              >
                {savingRoleUserId === user.id ? "Saving..." : "Save Role"}
              </button>

              <button onClick={() => onOpenReset(user)} className="text-xs underline">
                Reset Password
              </button>

              {(isMasterAdmin || !hasRole(user, "ADMIN")) && (
                <button
                  onClick={() => onToggleUser(user)}
                  disabled={togglingUserId === user.id}
                  className="text-xs underline disabled:opacity-60"
                >
                  {togglingUserId === user.id
                    ? "Updating..."
                    : user.is_active
                    ? "Disable"
                    : "Enable"}
                </button>
              )}

              {(isMasterAdmin || !hasRole(user, "ADMIN")) && (
                <button
                  onClick={() => onDeleteUser(user)}
                  disabled={deletingUserId === user.id}
                  className="text-xs text-red-400 underline disabled:opacity-60"
                >
                  {deletingUserId === user.id ? "Deleting..." : "Delete"}
                </button>
              )}
            </div>
          )}
        </td>
      </tr>

      {resetTargetId === user.id && !isProtected && (
        <tr className="border-b border-white/5">
          <td colSpan={6} className="py-2">
            <div className="flex flex-wrap items-center gap-2 bg-black/30 border border-white/10 rounded p-2">
              <span className="text-xs opacity-80">New password for {user.email}</span>
              <input
                type={showResetPwd ? "text" : "password"}
                className="px-2 py-1 rounded bg-black/40 border border-white/20 text-xs min-w-52"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete="new-password"
              />
              <button
                onClick={() => setShowResetPwd((v) => !v)}
                className="px-2 py-1 text-xs rounded border"
              >
                {showResetPwd ? "Hide" : "Show"}
              </button>
              <button
                onClick={() => submitResetPassword(user)}
                disabled={resettingUserId === user.id}
                className="px-2 py-1 text-xs rounded border border-green-500/40 text-green-400 disabled:opacity-60"
              >
                {resettingUserId === user.id ? "Resetting..." : "Confirm Reset"}
              </button>
              <button onClick={closeResetPassword} className="px-2 py-1 text-xs rounded border">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
