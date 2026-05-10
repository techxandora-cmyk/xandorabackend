import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import POS from "@/pages/POS";
import BillingPanel from "@/components/BillingPanel";

export default function CheckoutOps() {
  const { hasPermission } = useAuth();

  const tabs = useMemo(() => {
    const items = [];

    if (hasPermission("dashboard.view_pos")) {
      items.push({
        id: "pos",
        label: "Transactions",
        description: "View sales and returns recorded by your POS system",
      });
    }

    if (hasPermission("dashboard.view_billing")) {
      items.push({
        id: "billing",
        label: "Scan Session",
        description: "Track expected vs scanned items and review session accuracy",
      });
    }

    return items;
  }, [hasPermission]);

  const [activeTab, setActiveTab] = useState(() => tabs[0]?.id || "");

  useEffect(() => {
    if (!tabs.length) {
      setActiveTab("");
      return;
    }

    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  const activeTabMeta = tabs.find((tab) => tab.id === activeTab) || null;

  if (!tabs.length) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        You do not have permission to view checkout operations.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Checkout Operations</h1>
            <p className="text-xs text-white/55 mt-1">
              Run POS checkout, billing sessions, and scan monitoring from one screen.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "rounded border px-3 py-1.5 text-xs transition",
                    isActive
                      ? "border-white/30 bg-white/10"
                      : "border-white/10 text-white/75 hover:bg-white/10",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 text-xs text-white/55">
          {activeTabMeta?.description || ""}
        </div>
      </div>

      {activeTab === "pos" ? <POS /> : null}

      {activeTab === "billing" ? (
        <div className="space-y-4">
          <div className="glass rounded-xl p-5 border">
            <div className="text-sm font-semibold mb-1">Scan Session</div>
            <div className="text-xs text-black/60 dark:text-white/50">
              Start sessions, scan EPCs, and review billing history
            </div>
          </div>
          <BillingPanel />
        </div>
      ) : null}

    </div>
  );
}
