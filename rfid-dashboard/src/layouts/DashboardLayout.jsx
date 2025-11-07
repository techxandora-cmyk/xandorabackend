// src/layouts/DashboardLayout.jsx
import { Outlet, useLocation } from "react-router-dom";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import BrandSidebar from "../components/UI/BrandSidebar.jsx";
import TopBar from "../components/UI/TopBar.jsx";
import useTheme from "../hooks/useTheme.js";

export default function DashboardLayout() {
  const { isDark, toggle } = useTheme(true);
  const location = useLocation();

  const titles = {
    "/": "Overview",
    "/scan": "Scan",
    "/devices": "Devices",
    "/pos": "POS",
    "/security": "Security",
    "/logs": "Logs",
  };
  const title = titles[location.pathname] ?? "Dashboard";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-7xl flex">
        <BrandSidebar />
        <div className="flex-1 min-w-0">
          <TopBar title={title} onToggleTheme={toggle} isDark={isDark} />
          <main className="px-4 sm:px-6 lg:px-8 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
