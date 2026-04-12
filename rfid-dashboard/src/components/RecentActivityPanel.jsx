import { useNavigate } from "react-router-dom";

function typeMeta(type) {
  switch (type) {
    case "pos":
      return {
        icon: "💳",
        border: "border-l-violet-500",
        route: "/pos",
      };
    case "scan":
      return {
        icon: "📡",
        border: "border-l-cyan-500",
        route: "/scans",
      };
    case "alert":
      return {
        icon: "🚨",
        border: "border-l-red-500",
        route: "/alerts",
      };
    default:
      return {
        icon: "•",
        border: "border-l-gray-400",
        route: "/",
      };
  }
}

export default function RecentActivityPanel({ items = [] }) {
  const navigate = useNavigate();

  return (
    <div className="glass rounded-xl p-4 border">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Recent Activity</div>
        <div className="text-xs text-black/50 dark:text-white/40">
          Last events
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-black/40 dark:text-white/30">
          No recent activity
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a, i) => {
            const meta = typeMeta(a.type);

            return (
              <button
                key={i}
                onClick={() => navigate(meta.route)}
                className={`w-full text-left border-l-4 ${meta.border}
                  rounded-lg px-3 py-2
                  hover:bg-black/5 dark:hover:bg-white/10
                  transition cursor-pointer`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-2 min-w-0">
                    <div className="text-sm">{meta.icon}</div>

                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">
                        {a.title}
                      </div>
                      <div className="text-[11px] text-black/50 dark:text-white/40">
                        {a.store_id}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-black/40 dark:text-white/30 whitespace-nowrap">
                    {a.ts
                      ? new Date(a.ts).toLocaleString()
                      : "—"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
