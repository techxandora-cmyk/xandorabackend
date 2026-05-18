import { useAuth } from "@/context/AuthContext";
import POS from "@/pages/POS";

export default function CheckoutOps() {
  const { hasPermission } = useAuth();

  if (!hasPermission("dashboard.view_pos")) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        You do not have permission to view transaction history.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Transactions</h1>
            <p className="text-xs text-white/55 mt-1">
              Review retail console sales, returns, and recently scanned RFID items.
            </p>
          </div>
        </div>
      </div>

      <POS />
    </div>
  );
}
