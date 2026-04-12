// src/pages/Billing.jsx
import { useEffect } from "react";
import BillingPanel from "@/components/BillingPanel";

export default function Billing() {
  /* =========================
     ENABLE GLOW (Billing page)
  ========================= */
  useEffect(() => {
    document.body.classList.add("glow");
    return () => {
      document.body.classList.remove("glow");
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-5 border">
        <div className="text-sm font-semibold mb-1">Billing</div>
        <div className="text-xs text-black/60 dark:text-white/50">
          Start sessions, scan EPCs, and review billing history
        </div>
      </div>

      <BillingPanel />
    </div>
  );
}
