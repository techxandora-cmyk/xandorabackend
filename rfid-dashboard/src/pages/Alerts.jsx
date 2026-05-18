// src/pages/Alerts.jsx
import AlertsPanel from "@/components/AlertsPanel";

export default function Alerts() {
  return (
    <div className="space-y-6">
      <div className="glass p-5 border rounded-xl">
        <div className="text-lg font-semibold mb-1">Alerts</div>
        <div className="text-xs text-black/55 dark:text-white/55">
          Clear store issues, follow-up cases, and resolved history in one place.
        </div>
      </div>

      <AlertsPanel />
    </div>
  );
}
