import React, { useEffect, useState, useRef, useCallback } from 'react';

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || 'http://localhost:3000';

export default function SecurityAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollMs = 3000;
  const mounted = useRef(true);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/security/alerts?limit=50`);
      if (!res.ok) {
        const txt = await res.text().catch(() => null);
        console.error('SecurityAlerts fetch failed:', res.status, txt);
        return;
      }
      const data = await res.json();
      if (!mounted.current) return;
      // ensure offenders is an array for each alert
      const parsed = (data.alerts || []).map(a => {
        let offenders = a.offenders;
        try {
          if (typeof offenders === 'string') offenders = JSON.parse(offenders);
        } catch {
          offenders = [];
        }
        if (!Array.isArray(offenders)) offenders = [];
        return { ...a, offenders };
      });
      setAlerts(parsed);
    } catch (err) {
      console.error('fetchAlerts error', err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchAlerts();
    const id = setInterval(fetchAlerts, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [fetchAlerts, pollMs]);

  async function ack(id) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/security/alerts/${id}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'dashboard_user' })
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>null);
        console.error('Ack failed', res.status, txt);
      } else {
        // refresh after ack
        fetchAlerts();
      }
    } catch (err) {
      console.error('ack failed', err);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Security Alerts</h2>
        <div className="text-sm text-gray-500">{loading ? 'Refreshing...' : `${alerts.length} shown`}</div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-sm text-gray-600">No alerts</div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-3 rounded-md border ${alert.acknowledged ? 'bg-gray-100 border-gray-200' : 'bg-white border-red-200'}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm text-gray-600">
                    Reader: <strong>{alert.reader_id || '—'}</strong> • Location: <strong>{alert.location_id || '—'}</strong>
                  </div>
                  <div className="text-xs text-gray-500">Time: {new Date(alert.timestamp || alert.created_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm">
                    {alert.acknowledged ? (
                      <span className="text-green-600">Acknowledged</span>
                    ) : (
                      <button className="px-3 py-1 bg-red-600 text-white rounded" onClick={() => ack(alert.id)}>
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 text-sm">
                <div className="font-medium">Offenders:</div>
                <ul className="list-disc list-inside">
                  {Array.isArray(alert.offenders) && alert.offenders.length > 0 ? (
                    alert.offenders.map((o, i) => (
                      <li key={i}>
                        <strong>{o.epc}</strong> — {o.status} {o.reason ? `(${o.reason})` : ''} {o.reserved_txn ? `• reserved: ${o.reserved_txn}` : ''}
                      </li>
                    ))
                  ) : (
                    <li className="text-gray-500">No offender details</li>
                  )}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
