// src/handheld/HandheldApp.jsx
import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/useAuth";
import API_BASE from "@/config/api";


/* =========================================================
   HANDHELD API (simple fetch wrapper)
========================================================= */

function getToken() {
  return (
    localStorage.getItem("zyro_jwt") ||
    sessionStorage.getItem("zyro_jwt") ||
    null
  );
}

async function handheldFetch(path, options = {}) {
  const base = String(API_BASE || "").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const url = `${base}/${cleanPath}`;

  const token = getToken();

  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body || null,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg =
      (body && body.error) ||
      `Request failed with ${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

/* =========================================================
   INVENTORY API CALLS (Option A endpoints)
========================================================= */

async function startInventorySession(store_id) {
  return handheldFetch("/inventory/start", {
    method: "POST",
    body: JSON.stringify({ store_id }),
  });
}

async function scanInventoryItem(session_id, tag) {
  return handheldFetch(`/inventory/${session_id}/scan`, {
    method: "POST",
    body: JSON.stringify({ tag }),
  });
}

async function endInventorySession(session_id) {
  return handheldFetch(`/inventory/${session_id}/end`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function getInventoryReport(session_id) {
  return handheldFetch(`/inventory/${session_id}/report`, {
    method: "GET",
  });
}

/* =========================================================
   PERMISSIONS
   We now trust backend-issued JWT permissions.
========================================================= */

function hasPerm(auth, perm) {
  const permissions = auth?.user?.permissions || auth?.permissions || [];
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes("*")) return true;
  if (permissions.includes(perm)) return true;

  const aliases = {
    "handheld.scan": ["handheld.scan_items"],
    "handheld.inventory": ["handheld.inventory_count"],
    "handheld.audit": ["handheld.run_audits"],
  };

  const alt = aliases[perm] || [];
  return alt.some((key) => permissions.includes(key));
}

/* =========================================================
   UI SCREENS
========================================================= */

function HandheldHome({ auth, onGo }) {
  const canScan = hasPerm(auth, "handheld.scan_items");
  const canInventory = hasPerm(auth, "handheld.inventory_count");
  const canAudit = hasPerm(auth, "handheld.run_audits");

  return (
    <div className="space-y-4">
      <div className="text-sm text-white/70">
        Logged in as <span className="text-white font-semibold">{auth.user?.email}</span>
      </div>

      {canScan && (
        <button
          onClick={() => onGo("scan")}
          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
        >
          Scan Items
        </button>
      )}

      {canInventory && (
        <button
          onClick={() => onGo("inventory")}
          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
        >
          Inventory Count
        </button>
      )}

      {canAudit && (
        <button
          onClick={() => onGo("audit")}
          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
        >
          Run Audit
        </button>
      )}

      {!canScan && !canInventory && !canAudit && (
        <div className="text-sm text-red-300">
          You do not have access to handheld features.
        </div>
      )}
    </div>
  );
}

/* =========================================================
   INVENTORY SCREEN
========================================================= */

function InventoryScreen({ auth, onBack }) {
  const [storeId, setStoreId] = useState("STORE_001");

  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState("idle"); // idle | active | ended
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const [tagInput, setTagInput] = useState("");
  const [scanning, setScanning] = useState(false);

  const [scanned, setScanned] = useState([]);
  const [error, setError] = useState("");

  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const canInventory = hasPerm(auth, "handheld.inventory_count");

  useEffect(() => {
    if (!canInventory) {
      setError("You do not have permission to use inventory.");
    }
  }, [canInventory]);

  async function handleStart() {
    setError("");
    setReport(null);

    if (!storeId) {
      setError("Store is required.");
      return;
    }

    setStarting(true);
    try {
      const res = await startInventorySession(storeId);

      // expected backend shape: { ok:true, session:{ id, store_id, status } }
      const id = res?.session?.id || res?.id || null;

      if (!id) {
        throw new Error("Session start failed (no session id returned)");
      }

      setSessionId(id);
      setSessionStatus("active");
      setScanned([]);
    } catch (e) {
      setError(e.message || "Failed to start session");
    } finally {
      setStarting(false);
    }
  }

  async function handleScan() {
    setError("");

    if (!sessionId) {
      setError("Start a session first.");
      return;
    }

    const tag = String(tagInput || "").trim();
    if (!tag) {
      setError("Enter a tag EPC.");
      return;
    }

    setScanning(true);
    try {
      await scanInventoryItem(sessionId, tag);

      setScanned((prev) => [
        { tag, ts: new Date().toISOString() },
        ...prev,
      ]);

      setTagInput("");
    } catch (e) {
      setError(e.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleEnd() {
    setError("");
    if (!sessionId) return;

    setEnding(true);
    try {
      await endInventorySession(sessionId);
      setSessionStatus("ended");
    } catch (e) {
      setError(e.message || "Failed to end session");
    } finally {
      setEnding(false);
    }
  }

  async function handleReport() {
    setError("");
    if (!sessionId) {
      setError("No session.");
      return;
    }

    setLoadingReport(true);
    try {
      const res = await getInventoryReport(sessionId);
      setReport(res?.report || res);
    } catch (e) {
      setError(e.message || "Failed to load report");
    } finally {
      setLoadingReport(false);
    }
  }

  const scanCount = scanned.length;

  const foundCount = report?.found_count ?? report?.found?.length ?? null;
  const missingCount = report?.missing_count ?? report?.missing?.length ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Inventory Count</div>
          <div className="text-xs text-white/50">
            Start → Scan → End → Report
          </div>
        </div>

        <button
          onClick={onBack}
          className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10 text-sm"
        >
          Back
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* SESSION CARD */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-white/70">Session</div>
          <div className="text-xs text-white/50">
            Status:{" "}
            <span className="text-white/80">
              {sessionStatus.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs text-white/50">Store</label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={sessionStatus === "active"}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
            >
              <option value="STORE_001" className="bg-black text-white">
                STORE_001
              </option>
              <option value="STORE_002" className="bg-black text-white">
                STORE_002
              </option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={starting || sessionStatus === "active"}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white disabled:opacity-50"
            >
              {starting ? "Starting..." : "Start Session"}
            </button>

            <button
              onClick={handleEnd}
              disabled={ending || sessionStatus !== "active"}
              className="flex-1 py-3 rounded-xl bg-red-600 text-white disabled:opacity-50"
            >
              {ending ? "Ending..." : "End Session"}
            </button>
          </div>

          {sessionId && (
            <div className="text-xs text-white/50">
              Session ID: <span className="text-white/80">{sessionId}</span>
            </div>
          )}
        </div>
      </div>

      {/* SCAN CARD */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-white/70">Scan EPC</div>
          <div className="text-xs text-white/50">
            Scanned: <span className="text-white/80">{scanCount}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="EPC / Tag"
            className="flex-1 px-3 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-white/30"
            disabled={sessionStatus !== "active"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScan();
              }
            }}
          />
          <button
            onClick={handleScan}
            disabled={scanning || sessionStatus !== "active"}
            className="px-4 py-3 rounded-xl bg-blue-600 text-white disabled:opacity-50"
          >
            {scanning ? "..." : "Add"}
          </button>
        </div>

        {scanned.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-3 py-2 text-white/60">Tag</th>
                  <th className="text-left px-3 py-2 text-white/60">Time</th>
                </tr>
              </thead>
              <tbody>
                {scanned.slice(0, 50).map((s, idx) => (
                  <tr key={idx} className="border-t border-white/10">
                    <td className="px-3 py-2 text-white">{s.tag}</td>
                    <td className="px-3 py-2 text-white/50">
                      {new Date(s.ts).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleReport}
            disabled={loadingReport || !sessionId}
            className="flex-1 py-3 rounded-xl bg-purple-600 text-white disabled:opacity-50"
          >
            {loadingReport ? "Loading..." : "Get Report"}
          </button>

          <button
            onClick={() => {
              setScanned([]);
              setReport(null);
              setError("");
            }}
            className="px-4 py-3 rounded-xl border border-white/10 text-white/80 hover:bg-white/10"
          >
            Clear
          </button>
        </div>
      </div>

      {/* REPORT */}
      {report && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="text-sm text-white/70">Report</div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-xs text-white/50">Found</div>
              <div className="text-xl font-semibold text-white">
                {foundCount ?? "—"}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-xs text-white/50">Missing</div>
              <div className="text-xl font-semibold text-white">
                {missingCount ?? "—"}
              </div>
            </div>
          </div>

          <div className="text-xs text-white/40">
            Tip: next we will connect this to real RFID stream instead of manual EPC entry.
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   SCAN SCREEN (placeholder for next)
========================================================= */

function ScanScreen({ onBack }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Scan Items</div>
          <div className="text-xs text-white/50">
            Live RFID scan UI coming next.
          </div>
        </div>

        <button
          onClick={onBack}
          className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10 text-sm"
        >
          Back
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        This screen will show live EPC reads and allow “Submit batch”.
      </div>
    </div>
  );
}

/* =========================================================
   AUDIT SCREEN (placeholder)
========================================================= */

function AuditScreen({ onBack }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Audit</div>
          <div className="text-xs text-white/50">
            Audit flow UI coming next.
          </div>
        </div>

        <button
          onClick={onBack}
          className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10 text-sm"
        >
          Back
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        This screen will run audit checks and show anomalies.
      </div>
    </div>
  );
}

/* =========================================================
   ROOT HANDHELD APP
========================================================= */

export default function HandheldApp() {
  const auth = useAuth();
  const { user, logout } = auth;

  const [screen, setScreen] = useState("home"); // home | scan | inventory | audit

  if (!user) return null;

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Handheld</div>
            <div className="text-xs text-white/50">
              RFID Operations Console
            </div>
          </div>

          <button
            onClick={logout}
            className="text-xs underline text-white/70 hover:text-white"
          >
            Logout
          </button>
        </div>

        {/* BODY */}
        {screen === "home" && (
          <HandheldHome auth={auth} onGo={setScreen} />
        )}

        {screen === "scan" && (
          <ScanScreen onBack={() => setScreen("home")} />
        )}

        {screen === "inventory" && (
          <InventoryScreen auth={auth} onBack={() => setScreen("home")} />
        )}

        {screen === "audit" && (
          <AuditScreen onBack={() => setScreen("home")} />
        )}
      </div>
    </div>
  );
}
