// src/components/UI/BrandSidebar.jsx
import { NavLink } from "react-router-dom";
import {
  ActivitySquare,
  RadioTower,
  ShoppingBag,
  ScanLine,
  ShieldCheck,
  ListTree,
} from "lucide-react";

const nav = [
  { to: "/", label: "Overview", icon: ActivitySquare },
  { to: "/scan", label: "Scan", icon: ScanLine },
  { to: "/devices", label: "Devices", icon: RadioTower },
  { to: "/pos", label: "POS", icon: ShoppingBag },
  { to: "/security", label: "Security", icon: ShieldCheck },
  { to: "/logs", label: "Logs", icon: ListTree },
];

export default function BrandSidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-[240px] border-r border-black/5 dark:border-white/5 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl">
      <div className="h-14 flex items-center px-4 border-b border-black/5 dark:border-white/5">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            AuroraRFID
          </div>
        </div>
      </div>

      <nav className="p-2">
        {nav.map(({ to, label, icon: Icon }) => ( // eslint-disable-line no-unused-vars
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `group flex items-center gap-2 rounded-md px-3 py-2 text-sm
               transition-all duration-200
               ${isActive
                 ? "bg-violet-500/10 text-violet-700 dark:text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.3)]"
                 : "hover:bg-zinc-900/5 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-300"}`
            }
          >
            {/* Use Icon component */}
            <Icon size={18} className="shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
