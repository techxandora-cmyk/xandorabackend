import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";
import StatusIndicator from "./StatusIndicator";
import { useEffect, useMemo, useRef, useState } from "react";
import { initTheme, toggleDark } from "@/lib/theme";
import {
  LayoutDashboard,
  ShoppingCart,
  Cpu,
  Package,
  Bell,
  LogIn,
  LogOut,
  ClipboardList,
  Search,
  ShieldCheck,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";

const NAV_ITEMS_BY_PRODUCT = {
  retail: [
    { to: "", label: "Overview", icon: LayoutDashboard, perm: "dashboard.view_overview" },
    {
      to: "pos",
      label: "Transactions",
      icon: ShoppingCart,
      anyOf: ["dashboard.view_pos"],
    },
    { to: "devices", label: "Devices", icon: Cpu, perm: "dashboard.view_devices" },
    { to: "stock", label: "Stock", icon: Package, perm: "dashboard.view_stock" },
    { to: "alerts", label: "Alerts", icon: Bell, perm: "dashboard.view_alerts" },
  ],
  laundry: [
    {
      to: "laundry",
      label: "Dashboard",
      icon: LayoutDashboard,
      end: true,
      anyOf: ["dashboard.view_laundry", "dashboard.manage_laundry"],
    },
    {
      to: "laundry/inbound",
      label: "Inbound",
      icon: LogIn,
      anyOf: ["dashboard.view_laundry", "dashboard.manage_laundry"],
    },
    {
      to: "laundry/outbound",
      label: "Outbound",
      icon: LogOut,
      anyOf: ["dashboard.view_laundry", "dashboard.manage_laundry"],
    },
    {
      to: "laundry/data-entry",
      label: "Data Entry",
      icon: ClipboardList,
      anyOf: ["dashboard.view_laundry", "dashboard.manage_laundry"],
    },
    {
      to: "laundry/devices",
      label: "Devices",
      icon: Cpu,
      anyOf: ["dashboard.view_laundry", "dashboard.manage_laundry"],
    },
  ],
  stock_audit: [
    {
      to: "stock-audit",
      label: "Dashboard",
      icon: LayoutDashboard,
      end: true,
      anyOf: ["dashboard.view_stock_audit", "dashboard.manage_stock_audit"],
    },
    {
      to: "stock-audit/sessions",
      label: "Sessions",
      icon: ClipboardList,
      anyOf: ["dashboard.view_stock_audit", "dashboard.manage_stock_audit"],
    },
    {
      to: "stock-audit/findings",
      label: "Findings",
      icon: Search,
      anyOf: ["dashboard.view_stock_audit", "dashboard.manage_stock_audit"],
    },
    {
      to: "stock-audit/devices",
      label: "Devices",
      icon: Cpu,
      anyOf: ["dashboard.view_stock_audit", "dashboard.manage_stock_audit"],
    },
  ],
  portal: [],
};

function isInternalCompany(value) {
  return String(value || "").trim().toUpperCase() === "XANDORA";
}

function normalizeCompanyViewValue(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "GLOBAL VIEW" || upper === "GLOBAL_VIEW" || upper === "GLOBAL") {
    return "";
  }
  return value;
}

function areStoreListsEqual(a = [], b = []) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] || "") !== String(b[i] || "")) return false;
  }
  return true;
}

function areOptionsEqual(a = [], b = []) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] || {};
    const right = b[i] || {};
    if (String(left.value || "") !== String(right.value || "")) return false;
    if (String(left.label || "") !== String(right.label || "")) return false;
    const leftStores = Array.isArray(left.storeIds) ? left.storeIds : [];
    const rightStores = Array.isArray(right.storeIds) ? right.storeIds : [];
    if (!areStoreListsEqual(leftStores, rightStores)) return false;
  }
  return true;
}

function areNameMapsEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (!areStoreListsEqual(aKeys, bKeys)) return false;
  return aKeys.every((key) => String(a[key] || "") === String(b[key] || ""));
}

export default function Layout() {
  const {
    store_ids,
    user,
    logout,
    canAccessAdminUI,
    hasPermission,
    isMasterAdmin,
    productKey,
  } = useAuth();
  const navigate = useNavigate();

  const [isDark, setIsDark] = useState(() => initTheme().dark);
  const tokenStores = useMemo(() => {
    return Array.from(
      new Set(
        (Array.isArray(store_ids) ? store_ids : [])
          .map((s) => String(s || "").trim())
          .filter(Boolean)
      )
    );
  }, [store_ids]);

  const [stores, setStores] = useState(tokenStores);
  const [storeNameById, setStoreNameById] = useState({});
  const [adminStoreRows, setAdminStoreRows] = useState([]);
  const [accountOptions, setAccountOptions] = useState([]);
  const [storeId, setStoreId] = useState(() => {
    const persisted = localStorage.getItem("xandora_store_id") || "";
    return persisted || tokenStores[0] || "";
  });
  const [companyView, setCompanyView] = useState(() =>
    normalizeCompanyViewValue(localStorage.getItem("xandora_company_view") || "")
  );
  const [open, setOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const didRunStoreSyncRef = useRef(false);

  async function refreshAccessibleStores() {
    if (!canAccessAdminUI) {
      setStores((prev) => (areStoreListsEqual(prev, tokenStores) ? prev : tokenStores));
      setStoreNameById((prev) => (areNameMapsEqual(prev, {}) ? prev : {}));
      setAdminStoreRows((prev) => (prev.length ? [] : prev));
      setAccountOptions((prev) => (prev.length ? [] : prev));
      return;
    }

    try {
      const scopedCompany = String(companyView || "").trim();
      const res = await apiGet("/admin/stores");
      const rows = (Array.isArray(res?.stores) ? res.stores : [])
        .map((row) => ({
          ...row,
          company_name: String(row?.company_name || "").trim(),
          store_id: String(row?.store_id || "").trim(),
          store_name: String(row?.store_name || "").trim(),
        }))
        .filter((row) => Boolean(row.store_id));

      setAdminStoreRows((prev) => {
        const prevSlim = prev.map((row) => ({
          company_name: String(row?.company_name || ""),
          store_id: String(row?.store_id || ""),
          store_name: String(row?.store_name || ""),
          is_active: Boolean(row?.is_active),
          updated_at: String(row?.updated_at || ""),
          user_count: Number(row?.user_count || 0),
        }));
        const nextSlim = rows.map((row) => ({
          company_name: String(row?.company_name || ""),
          store_id: String(row?.store_id || ""),
          store_name: String(row?.store_name || ""),
          is_active: Boolean(row?.is_active),
          updated_at: String(row?.updated_at || ""),
          user_count: Number(row?.user_count || 0),
        }));
        return JSON.stringify(prevSlim) === JSON.stringify(nextSlim) ? prev : rows;
      });

      const companies = Array.from(
        new Set(
          rows
            .map((row) => row.company_name)
            .filter((name) => Boolean(name) && !isInternalCompany(name))
        )
      ).sort((a, b) => a.localeCompare(b));

      if (isMasterAdmin) {
        try {
          const usersRes = await apiGet("/admin/users");
          const users = Array.isArray(usersRes?.users) ? usersRes.users : [];
          const byCompany = new Map();

          for (const row of users) {
            const companyName = String(row?.company_name || "").trim();
            if (!companyName || isInternalCompany(companyName)) continue;

            const roleRows = Array.isArray(row?.roles) ? row.roles : [];
            const isAdminAccount = roleRows.some(
              (r) => String(r?.role || "").trim().toUpperCase() === "ADMIN"
            );
            const isMasterOnly = roleRows.some(
              (r) => String(r?.role || "").trim().toUpperCase() === "MASTER_ADMIN"
            );
            if (!isAdminAccount || isMasterOnly) continue;

            if (byCompany.has(companyName)) continue;

            const email = String(row?.email || "").trim();
            const storeIds = Array.from(
              new Set(
                roleRows
                  .map((r) => String(r?.store_id || "").trim())
                  .filter((s) => Boolean(s) && s !== "_GLOBAL_")
              )
            );
            byCompany.set(companyName, {
              value: companyName,
              label: email ? `${companyName} - ${email}` : companyName,
              storeIds,
            });
          }

          const nextAccounts =
            byCompany.size > 0
              ? Array.from(byCompany.values()).sort((a, b) =>
                  a.value.localeCompare(b.value)
                )
              : companies.map((companyName) => ({
                  value: companyName,
                  label: companyName,
                  storeIds: [],
                }));
          setAccountOptions((prev) =>
            areOptionsEqual(prev, nextAccounts) ? prev : nextAccounts
          );
        } catch (e) {
          console.warn("[layout] failed to load admin accounts", e?.message || e);
          const fallback = companies.map((companyName) => ({
            value: companyName,
            label: companyName,
          }));
          setAccountOptions((prev) =>
            areOptionsEqual(prev, fallback) ? prev : fallback
          );
        }
      } else {
        setAccountOptions((prev) => (prev.length ? [] : prev));
      }

      const visibleRows = isMasterAdmin
        ? scopedCompany
          ? rows.filter((row) => row.company_name === scopedCompany)
          : []
        : rows;

      const adminStores = Array.from(
        new Set(
          visibleRows
            .map((row) => row.store_id)
            .filter(Boolean)
        )
      );
      const names = {};
      visibleRows.forEach((row) => {
        const id = row.store_id;
        if (!id) return;
        const name = row.store_name;
        names[id] = name || id;
      });

      setStores((prev) => (areStoreListsEqual(prev, adminStores) ? prev : adminStores));
      setStoreNameById((prev) => (areNameMapsEqual(prev, names) ? prev : names));
      return;
    } catch (e) {
      console.warn("[layout] failed to load admin stores", e?.message || e);

      if (isMasterAdmin) {
        try {
          const usersRes = await apiGet("/admin/users");
          const users = Array.isArray(usersRes?.users) ? usersRes.users : [];
          const fallbackAccounts = users
            .map((row) => {
              const companyName = String(row?.company_name || "").trim();
              if (!companyName || isInternalCompany(companyName)) return null;
              const roleRows = Array.isArray(row?.roles) ? row.roles : [];
              const isAdminAccount = roleRows.some(
                (r) => String(r?.role || "").trim().toUpperCase() === "ADMIN"
              );
              const isMasterOnly = roleRows.some(
                (r) => String(r?.role || "").trim().toUpperCase() === "MASTER_ADMIN"
              );
              if (!isAdminAccount || isMasterOnly) return null;
              const email = String(row?.email || "").trim();
              const storeIds = Array.from(
                new Set(
                  roleRows
                    .map((r) => String(r?.store_id || "").trim())
                    .filter((s) => Boolean(s) && s !== "_GLOBAL_")
                )
              );
              return {
                value: companyName,
                label: email ? `${companyName} - ${email}` : companyName,
                storeIds,
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.value.localeCompare(b.value));

          if (fallbackAccounts.length > 0) {
            setAccountOptions((prev) =>
              areOptionsEqual(prev, fallbackAccounts) ? prev : fallbackAccounts
            );
          }
        } catch (usersErr) {
          console.warn(
            "[layout] failed to load fallback admin accounts",
            usersErr?.message || usersErr
          );
        }
      }
    }

    setStores((prev) =>
      prev.length ? prev : areStoreListsEqual(prev, tokenStores) ? prev : tokenStores
    );
    setStoreNameById((prev) => (Object.keys(prev).length ? prev : {}));
    setAdminStoreRows((prev) => (prev.length ? prev : []));
    setAccountOptions((prev) => (prev.length ? prev : []));
  }

  useEffect(() => {
    setStores(tokenStores);
    setStoreNameById({});
  }, [tokenStores]);

  useEffect(() => {
    refreshAccessibleStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessAdminUI, user?.company_name, tokenStores.join("|"), companyView, isMasterAdmin]);

  useEffect(() => {
    function handleStoreEvents() {
      refreshAccessibleStores();
    }

    window.addEventListener("xandora_stores_updated", handleStoreEvents);
    return () => {
      window.removeEventListener("xandora_stores_updated", handleStoreEvents);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessAdminUI, tokenStores.join("|"), companyView, isMasterAdmin]);

  useEffect(() => {
    if (!stores.length) {
      if (storeId) setStoreId("");
      localStorage.removeItem("xandora_store_id");
      return;
    }

    if (!stores.includes(storeId)) {
      setStoreId(stores[0]);
    }
  }, [stores, storeId]);

  useEffect(() => {
    if (!didRunStoreSyncRef.current) {
      didRunStoreSyncRef.current = true;
      return;
    }

    if (storeId) {
      localStorage.setItem("xandora_store_id", storeId);
    } else {
      localStorage.removeItem("xandora_store_id");
    }
    window.dispatchEvent(new Event("xandora_store_changed"));
  }, [storeId]);

  useEffect(() => {
    function syncCompanyView() {
      const normalized = normalizeCompanyViewValue(
        localStorage.getItem("xandora_company_view") || ""
      );
      setCompanyView((prev) => (prev === normalized ? prev : normalized));
      if (!normalized) {
        localStorage.removeItem("xandora_company_view");
      }
    }

    window.addEventListener("storage", syncCompanyView);
    window.addEventListener("xandora_company_view_changed", syncCompanyView);
    return () => {
      window.removeEventListener("storage", syncCompanyView);
      window.removeEventListener("xandora_company_view_changed", syncCompanyView);
    };
  }, []);

  const roleBadge = useMemo(() => {
    const roles = Array.isArray(user?.roles) ? user.roles : [];

    if (roles.includes("MASTER_ADMIN")) {
      return {
        label: "MASTER ADMIN",
        className: "border-red-500/60 text-red-400",
        key: "MASTER_ADMIN",
      };
    }

    if (roles.includes("ADMIN")) {
      return {
        label: "ADMIN",
        className: "border-purple-500/60 text-purple-400",
        key: "ADMIN",
      };
    }

    if (roles.includes("STORE_MANAGER")) {
      return {
        label: "STORE MANAGER",
        className: "border-blue-500/60 text-blue-400",
        key: "STORE_MANAGER",
      };
    }

    if (roles.includes("HANDHELD_USER")) {
      return {
        label: "HANDHELD USER",
        className: "border-cyan-500/60 text-cyan-400",
        key: "HANDHELD_USER",
      };
    }

    return {
      label: "STORE STAFF",
      className: "border-green-500/60 text-green-400",
      key: "STORE_STAFF",
    };
  }, [user]);

  const badgeSeenKey = `xandora_badge_seen_${roleBadge.key}`;
  const animateOnce = !sessionStorage.getItem(badgeSeenKey);

  useEffect(() => {
    if (animateOnce) {
      sessionStorage.setItem(badgeSeenKey, "1");
    }
  }, [animateOnce, badgeSeenKey]);

  function onToggleTheme() {
    const nextDark = toggleDark();
    setIsDark(nextDark);
  }

  function onCompanyChange(nextCompanyRaw) {
    if (!isMasterAdmin) return;

    const nextCompany = String(nextCompanyRaw || "").trim();
    if (nextCompany) {
      localStorage.setItem("xandora_company_view", nextCompany);
    } else {
      localStorage.removeItem("xandora_company_view");
    }
    setCompanyView(nextCompany);
    window.dispatchEvent(new Event("xandora_company_view_changed"));

    const scopedStoreIds = Array.from(
      new Set(
        adminStoreRows
          .filter((row) => String(row?.company_name || "").trim() === nextCompany)
          .map((row) => String(row?.store_id || "").trim())
          .filter(Boolean)
      )
    );
    const fallbackAccountStoreIds = Array.from(
      new Set(
        (accountOptions.find((opt) => opt.value === nextCompany)?.storeIds || [])
          .map((s) => String(s || "").trim())
          .filter(Boolean)
      )
    );
    const candidateStoreIds = scopedStoreIds.length
      ? scopedStoreIds
      : fallbackAccountStoreIds;

    const persistedStore = String(localStorage.getItem("xandora_store_id") || "").trim();
    const nextStoreId = nextCompany
      ? candidateStoreIds.includes(persistedStore)
        ? persistedStore
        : candidateStoreIds[0] || ""
      : "";

    if (nextStoreId) {
      localStorage.setItem("xandora_store_id", nextStoreId);
    } else {
      localStorage.removeItem("xandora_store_id");
    }
    setStoreId(nextStoreId);
    window.dispatchEvent(new Event("xandora_store_changed"));

    // Drop master admin into the customer's users view (forces navigation even if already on /admin)
    if (nextCompany) {
      navigate("/admin/users");
    }
  }

  function goBackToMyAccount() {
    onCompanyChange("");
    setOpen(false);
    window.location.assign("/");
  }

  function canViewNavItem(item) {
    const required =
      Array.isArray(item?.anyOf) && item.anyOf.length
        ? item.anyOf
        : item?.perm
        ? [item.perm]
        : [];
    return required.some((perm) => hasPermission(perm));
  }

  const navItems = NAV_ITEMS_BY_PRODUCT[productKey] || [];

  const headerClass = isDark
    ? "border-cyan-400/15 bg-[#091523]/72 shadow-[0_8px_30px_rgba(9,21,35,0.55)]"
    : "border-[#418EDA]/25 bg-white/80 shadow-[0_8px_24px_rgba(65,142,218,0.18)]";

  const navIdleClass = isDark
    ? "border-white/15 text-white/85 hover:bg-white/10"
    : "border-[#A3B8CC]/65 text-[#1A263D] hover:bg-[#F2F9FF]";

  const navActiveClass = isDark
    ? "border-[#16F9F3]/55 bg-[#8C11E7]/18 text-[#DBE4ED] shadow-[0_0_16px_rgba(140,17,231,0.4)]"
    : "border-[#8C11E7]/38 bg-[#8C11E7]/9 text-[#2B3990] shadow-[0_0_16px_rgba(65,142,218,0.22)]";

  const selectClass = isDark
    ? "text-[#DBE4ED] bg-[#1A263D]/65 border-white/20 hover:border-[#418EDA]/55"
    : "text-[#1A263D] bg-white/75 border-[#A3B8CC]/75 hover:border-[#418EDA]/60";
  const showPortalNav = productKey === "portal" && canAccessAdminUI;
  const showContractsNav = productKey === "portal" && isMasterAdmin;
  const showAccountSelector =
    productKey === "portal" && isMasterAdmin && canAccessAdminUI;
  const showStoreSelector =
    productKey !== "portal" && !(isMasterAdmin && !companyView);
  const shouldShowStorePlaceholder =
    productKey !== "portal" && !showStoreSelector;

  return (
    <div className={`brand-shell ${!isDark ? "light-override" : ""}`}>
      <header className={`sticky top-0 z-50 border-b backdrop-blur-xl ${headerClass}`}>
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4">
          <div className="relative ml-16 flex items-center gap-3 sm:ml-24">
            <div className="relative">
              <span className="brand-logo-halo" />
              <img
                src="/xandora-icon.svg"
                alt="Xandora logo"
                className="block h-9 w-9 sm:h-10 sm:w-10"
              />
            </div>
          </div>

          <nav className="hidden md:flex gap-1.5">
            {navItems.filter((item) => canViewNavItem(item)).map((item) => {
              const Icon = item.icon || null;
              return (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={Boolean(item.end) || item.to === ""}
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-all",
                      isActive ? navActiveClass : navIdleClass,
                    ].join(" ")
                  }
                >
                  {Icon && <Icon size={13} strokeWidth={2} />}
                  {item.label}
                </NavLink>
              );
            })}

            {showPortalNav && (
              <NavLink
                to="admin"
                className={({ isActive }) =>
                  [
                    "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-all",
                    isActive ? navActiveClass : navIdleClass,
                  ].join(" ")
                }
              >
                <ShieldCheck size={13} strokeWidth={2} />
                Admin
              </NavLink>
            )}

            {showContractsNav && (
              <NavLink
                to="admin/contracts"
                className={({ isActive }) =>
                  [
                    "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-all",
                    isActive ? navActiveClass : navIdleClass,
                  ].join(" ")
                }
              >
                <ClipboardList size={13} strokeWidth={2} />
                Contracts
              </NavLink>
            )}
          </nav>

          <div className="relative flex items-center gap-2">
            {/* Company scope indicator — display only */}
            {companyView && canAccessAdminUI && (
              <span className="hidden md:inline rounded-full border border-cyan-500/45 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300">
                {companyView}
              </span>
            )}

            {/* Theme toggle — icon only on mobile */}
            <button
              type="button"
              onClick={onToggleTheme}
              className="theme-toggle-btn inline-flex items-center gap-1.5"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
              <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
            </button>

            {/* Store selector — compact on mobile */}
            {showStoreSelector && (
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={!stores.length}
                className={[
                  "max-w-[120px] md:max-w-none rounded border px-2 py-1 text-xs focus:outline-none",
                  selectClass,
                ].join(" ")}
              >
                {stores.length ? (
                  stores.map((s) => (
                    <option key={s} value={s}>
                      {storeNameById[s] || s}
                    </option>
                  ))
                ) : (
                  <option value="">No store assigned</option>
                )}
              </select>
            )}

            {shouldShowStorePlaceholder && (
              <span className="hidden md:inline rounded border border-slate-500/40 px-2 py-1 text-[10px] opacity-80">
                Select customer
              </span>
            )}

            <StatusIndicator />

            {/* Role badge / profile — desktop only */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={[
                "hidden md:flex rounded-full border px-3 py-1 text-[10px] glow-border",
                roleBadge.className,
                animateOnce ? "animate-pulse-once" : "",
              ].join(" ")}
            >
              {roleBadge.label}
            </button>

            {/* Desktop profile dropdown */}
            {open && (
              <div
                className={[
                  "absolute right-0 top-12 w-60 max-w-[90vw] rounded-xl border backdrop-blur-xl shadow-lg overflow-hidden z-50",
                  isDark
                    ? "border-white/12 bg-[#091523]/95"
                    : "border-[#A3B8CC]/75 bg-white/95",
                ].join(" ")}
              >
                <div className={["px-4 py-3 border-b", isDark ? "border-white/8" : "border-black/6"].join(" ")}>
                  {isMasterAdmin && companyView ? (
                    <button
                      type="button"
                      onClick={goBackToMyAccount}
                      className={[
                        "w-full text-left text-xs hover:opacity-80 transition-opacity",
                        isDark ? "text-cyan-300" : "text-cyan-700",
                      ].join(" ")}
                      title="Go back to your account view"
                    >
                      {user?.email}
                    </button>
                  ) : (
                    <div className={["text-xs font-medium truncate", isDark ? "text-[#DBE4ED]" : "text-[#1A263D]"].join(" ")}>
                      {user?.email}
                    </div>
                  )}
                  {storeId && (
                    <div className={["mt-1 text-[10px] truncate", isDark ? "text-white/45" : "text-black/45"].join(" ")}>
                      {storeNameById[storeId] || storeId}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setOpen(false); navigate("/change-password"); }}
                  className={["w-full px-4 py-2.5 text-left text-xs hover:bg-white/6 transition-colors", isDark ? "text-white/70" : "text-[#1A263D]/80"].join(" ")}
                >
                  Change password
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full px-4 py-2.5 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}

            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => { setMobileNavOpen((v) => !v); setOpen(false); }}
              className={[
                "md:hidden inline-flex items-center justify-center rounded border p-1.5 transition-colors",
                isDark
                  ? "border-white/15 text-white/85 hover:bg-white/10"
                  : "border-[#A3B8CC]/65 text-[#1A263D] hover:bg-[#F2F9FF]",
              ].join(" ")}
              aria-label="Toggle menu"
            >
              {mobileNavOpen ? <X size={18} strokeWidth={2} /> : <Menu size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <div className={["md:hidden border-t pb-4", isDark ? "border-white/10" : "border-[#A3B8CC]/30"].join(" ")}>
            <div className="mx-auto max-w-[1280px] px-4 pt-3 flex flex-col gap-1.5">

              {/* Nav items */}
              {navItems.filter((item) => canViewNavItem(item)).map((item) => {
                const Icon = item.icon || null;
                return (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={Boolean(item.end) || item.to === ""}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      [
                        "inline-flex items-center gap-2 rounded border px-4 py-3 text-sm transition-all",
                        isActive ? navActiveClass : navIdleClass,
                      ].join(" ")
                    }
                  >
                    {Icon && <Icon size={15} strokeWidth={2} />}
                    {item.label}
                  </NavLink>
                );
              })}

              {showPortalNav && (
                <NavLink
                  to="admin"
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    ["inline-flex items-center gap-2 rounded border px-4 py-3 text-sm transition-all",
                     isActive ? navActiveClass : navIdleClass].join(" ")
                  }
                >
                  <ShieldCheck size={15} strokeWidth={2} />
                  Admin
                </NavLink>
              )}

              {showContractsNav && (
                <NavLink
                  to="admin/contracts"
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    ["inline-flex items-center gap-2 rounded border px-4 py-3 text-sm transition-all",
                     isActive ? navActiveClass : navIdleClass].join(" ")
                  }
                >
                  <ClipboardList size={15} strokeWidth={2} />
                  Contracts
                </NavLink>
              )}


              {/* Divider + user info + sign out */}
              <div className={["mt-2 pt-3 border-t flex items-center justify-between gap-3", isDark ? "border-white/10" : "border-black/8"].join(" ")}>
                <div className="flex flex-col min-w-0">
                  <span className={["text-xs font-medium truncate", isDark ? "text-[#DBE4ED]" : "text-[#1A263D]"].join(" ")}>
                    {user?.email}
                  </span>
                  <span className={["text-[10px] mt-0.5", isDark ? "text-white/45" : "text-black/45"].join(" ")}>
                    {roleBadge.label}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setMobileNavOpen(false); navigate("/change-password"); }}
                    className={["text-xs px-3 py-1.5 rounded border transition-colors", isDark ? "border-white/20 text-white/70 hover:bg-white/10" : "border-black/15 text-[#1A263D]/70 hover:bg-black/5"].join(" ")}
                  >
                    Change password
                  </button>
                  <button
                    type="button"
                    onClick={() => { logout(); setMobileNavOpen(false); }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded border border-red-500/30 hover:bg-red-500/10"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
