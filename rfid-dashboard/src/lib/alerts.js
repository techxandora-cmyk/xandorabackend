import API_BASE from "@/config/api";


export async function fetchAlerts(token) {
  const res = await fetch(`${API_BASE}/inventory/alerts/dashboard`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}
