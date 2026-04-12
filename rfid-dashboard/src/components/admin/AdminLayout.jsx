import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function AdminLayout() {
  const { isMasterAdmin, hasPermission } = useAuth();

  const linkBase = "block px-3 py-2 text-xs rounded border transition-all";
  const linkInactive = "border-white/10 hover:bg-white/10";
  const linkActive =
    "border-purple-500/60 bg-purple-500/10 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.45)]";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="glass rounded-xl p-4 space-y-1">
        <h3 className="text-xs font-semibold text-purple-300 mb-3">Admin Panel</h3>

        {(isMasterAdmin || hasPermission("dashboard.manage_users")) && (
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Dashboard
          </NavLink>
        )}

        {(isMasterAdmin || hasPermission("dashboard.manage_users")) && (
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Users
          </NavLink>
        )}

        {(isMasterAdmin || hasPermission("dashboard.manage_users")) && (
          <NavLink
            to="/admin/stores"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Stores
          </NavLink>
        )}

        {isMasterAdmin && (
          <NavLink
            to="/admin/software"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Software
          </NavLink>
        )}

        {(isMasterAdmin || hasPermission("dashboard.manage_roles")) && (
          <NavLink
            to="/admin/roles"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Roles
          </NavLink>
        )}

        {(isMasterAdmin || hasPermission("dashboard.view_alerts")) && (
          <NavLink
            to="/admin/alerts"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Alerts
          </NavLink>
        )}

        {isMasterAdmin && (
          <NavLink
            to="/admin/contracts"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Contracts
          </NavLink>
        )}

        {(isMasterAdmin || hasPermission("dashboard.view_audit_logs")) && (
          <NavLink
            to="/admin/audit"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Audit
          </NavLink>
        )}
      </aside>

      <section className="min-h-[400px]">
        <Outlet />
      </section>
    </div>
  );
}
