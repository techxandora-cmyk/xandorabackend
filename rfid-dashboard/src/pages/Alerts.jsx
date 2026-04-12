// src/pages/Alerts.jsx
import AlertsPanel from "@/components/AlertsPanel";

export default function Alerts() {
  return (
    <div className="space-y-6">
      <div className="glass p-5 border rounded-xl">
        <div className="text-sm font-semibold mb-1">Alerts</div>
        <div className="text-xs opacity-60">
          Operational and system alerts by store
        </div>
      </div>

      <AlertsPanel />
    </div>
  );
}
