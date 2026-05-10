// src/pages/Devices.jsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const DEFAULT_ALERT_RULES = {
  exit_unpaid_enabled: true,
  changing_room_dwell_enabled: true,
  changing_room_dwell_minutes: 40,
};

const ZONE_ROLE_OPTIONS = [
  { value: "UNASSIGNED", label: "Unassigned" },
  { value: "POS", label: "POS" },
  { value: "EXIT", label: "Exit" },
  { value: "ENTRANCE", label: "Entrance" },
  { value: "CHANGING_ROOM", label: "Changing Room" },
  { value: "SALES_FLOOR", label: "Sales Floor" },
  { value: "BACKROOM", label: "Backroom" },
];

const FALLBACK_SECTION_PROFILES = [
  {
    id: "POS_READER",
    label: "POS Reader",
    description: "Used for billing/POS read zone",
    default_alert_rules: {
      exit_unpaid_enabled: false,
      changing_room_dwell_enabled: false,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "POS",
  },
  {
    id: "SECURITY_EXIT",
    label: "Security Exit",
    description: "Exit gate where unpaid exits should trigger",
    default_alert_rules: {
      exit_unpaid_enabled: true,
      changing_room_dwell_enabled: false,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "EXIT",
  },
  {
    id: "CHANGING_ROOM",
    label: "Changing Room",
    description: "Fitting/changing room dwell monitoring zone",
    default_alert_rules: {
      exit_unpaid_enabled: false,
      changing_room_dwell_enabled: true,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "CHANGING_ROOM",
  },
  {
    id: "ENTRY_GATE",
    label: "Entry Gate",
    description: "Store entry/entrance zone",
    default_alert_rules: {
      exit_unpaid_enabled: false,
      changing_room_dwell_enabled: false,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "ENTRANCE",
  },
  {
    id: "SALES_FLOOR",
    label: "Sales Floor",
    description: "General in-store read zone",
    default_alert_rules: {
      exit_unpaid_enabled: false,
      changing_room_dwell_enabled: false,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "SALES_FLOOR",
  },
  {
    id: "BACKROOM",
    label: "Backroom",
    description: "Stock/backroom handling zone",
    default_alert_rules: {
      exit_unpaid_enabled: false,
      changing_room_dwell_enabled: false,
      changing_room_dwell_minutes: 40,
    },
    default_zone_role: "BACKROOM",
  },
];

function normalizeDeviceId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function resolveStoreId(value) {
  return String(value || "STORE_001")
    .trim()
    .toUpperCase();
}

function timeAgo(ts) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
}

function toRole(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  return ZONE_ROLE_OPTIONS.some((r) => r.value === raw) ? raw : "UNASSIGNED";
}

function normalizeAlertRules(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const mins = Number(obj.changing_room_dwell_minutes);
  return {
    exit_unpaid_enabled:
      typeof obj.exit_unpaid_enabled === "boolean"
        ? obj.exit_unpaid_enabled
        : DEFAULT_ALERT_RULES.exit_unpaid_enabled,
    changing_room_dwell_enabled:
      typeof obj.changing_room_dwell_enabled === "boolean"
        ? obj.changing_room_dwell_enabled
        : DEFAULT_ALERT_RULES.changing_room_dwell_enabled,
    changing_room_dwell_minutes: Number.isFinite(mins)
      ? Math.min(Math.max(Math.round(mins), 5), 240)
      : DEFAULT_ALERT_RULES.changing_room_dwell_minutes,
  };
}

function normalizeAntennas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      const antennaId = Number(a?.antenna_id || 0);
      if (!Number.isInteger(antennaId) || antennaId <= 0) return null;
      return {
        antenna_id: antennaId,
        name: String(a?.name || `Antenna ${antennaId}`).trim() || `Antenna ${antennaId}`,
        zone_role: toRole(a?.zone_role),
        enabled: a?.enabled !== false,
        status: String(a?.status || "unknown"),
        reads_30d: Number(a?.reads_30d || 0),
        last_seen_at: a?.last_seen_at || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.antenna_id - b.antenna_id);
}

function nextAntennaId(antennas) {
  const ids = new Set(normalizeAntennas(antennas).map((a) => a.antenna_id));
  let id = 1;
  while (ids.has(id)) id += 1;
  return id;
}

function statusClass(status) {
  const s = String(status || "unknown").toLowerCase();
  if (s === "online") return "text-green-400 border-green-500/40 bg-green-500/10";
  if (s === "offline") return "text-red-400 border-red-500/40 bg-red-500/10";
  return "text-yellow-300 border-yellow-500/40 bg-yellow-500/10";
}

function readerOnlineClass(online) {
  return online
    ? "text-green-300 border-green-500/30 bg-green-500/10"
    : "text-red-300 border-red-500/30 bg-red-500/10";
}

function lifecycleClass(state) {
  const s = String(state || "").toUpperCase();
  if (s === "ONLINE") return "text-green-300 border-green-500/30 bg-green-500/10";
  if (s === "OFFLINE") return "text-red-300 border-red-500/30 bg-red-500/10";
  if (s === "CLAIMED") return "text-cyan-300 border-cyan-500/30 bg-cyan-500/10";
  return "text-yellow-300 border-yellow-500/30 bg-yellow-500/10";
}

function antennaStatusClass(status) {
  const s = String(status || "unknown").toLowerCase();
  if (s === "active") return "text-green-300 border-green-500/30 bg-green-500/10";
  if (s === "idle") return "text-yellow-300 border-yellow-500/30 bg-yellow-500/10";
  return "text-slate-300 border-slate-500/30 bg-slate-500/10";
}

function toDraft(device) {
  return {
    name: String(device?.name || ""),
    section_profile: String(device?.section_profile || "").toUpperCase(),
    apply_profile_defaults: false,
    alert_rules: normalizeAlertRules(device?.alert_rules),
    antennas: normalizeAntennas(device?.antennas || device?.antenna_config || []),
  };
}

function inferProfile(device, profiles) {
  const existing = String(device?.section_profile || "").toUpperCase();
  if (existing) return existing;

  const antennas = normalizeAntennas(device?.antennas || device?.antenna_config || []);
  const dominant = antennas.find((a) => a.zone_role && a.zone_role !== "UNASSIGNED");
  if (!dominant) return "";

  const zoneRole = dominant.zone_role;
  const match = profiles.find((p) => {
    const role = String(p?.default_zone_role || "")
      .trim()
      .toUpperCase();
    return role === zoneRole;
  });

  return match ? String(match.id || "").toUpperCase() : "";
}

function shapeDeviceRow(row) {
  const raw = row && typeof row === "object" ? row : {};
  const metadata =
    raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const zones =
    metadata.device_zones && typeof metadata.device_zones === "object"
      ? metadata.device_zones
      : {};

  const deviceId = String(raw.device_id || raw.id || "").trim();
  const status = String(raw.status || "").trim().toLowerCase();
  const readerOnline =
    typeof raw.reader_online === "boolean"
      ? raw.reader_online
      : status === "online";

  const sectionProfile = String(
    raw.section_profile || metadata.section_profile || zones.section_profile || ""
  )
    .trim()
    .toUpperCase();
  const provisioningState = String(
    raw.provisioning_state || raw.provisioning?.state || ""
  )
    .trim()
    .toUpperCase();
  const claimed =
    typeof raw.claimed === "boolean"
      ? raw.claimed
      : provisioningState === "CLAIMED";
  const lifecycleState = String(raw.lifecycle_state || "")
    .trim()
    .toUpperCase();
  const fallbackLifecycle = claimed
    ? readerOnline
      ? "ONLINE"
      : "OFFLINE"
    : "UNCLAIMED";

  return {
    device_id: deviceId,
    name: String(raw.name || raw.display_name || deviceId),
    display_name: String(raw.display_name || raw.name || deviceId),
    store_id: String(raw.store_id || "").trim(),
    device_type: String(raw.device_type || "FIXED_READER")
      .trim()
      .toUpperCase(),
    location_label: String(raw.location_label || "").trim(),
    zone_label: String(raw.zone_label || "").trim(),
    status: status || "unknown",
    reader_online: readerOnline,
    last_seen: raw.last_seen || raw.updated_at || null,
    last_heartbeat: raw.last_heartbeat || raw.last_seen || raw.updated_at || null,
    section_profile: sectionProfile || null,
    provisioning_state: provisioningState,
    connectivity_state: String(
      raw.connectivity_state || raw.connectivity?.state || ""
    )
      .trim()
      .toUpperCase(),
    lifecycle_state: lifecycleState || fallbackLifecycle,
    claimed,
    alert_rules: normalizeAlertRules(
      raw.alert_rules || zones.alert_rules || metadata.alert_rules
    ),
    antennas: normalizeAntennas(
      raw.antennas || raw.antenna_config || zones.antennas || metadata.antennas
    ),
  };
}

async function withTimeout(promise, ms, label = "request") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default function Devices() {
  const { isMasterAdmin } = useAuth();
  const [storeId, setStoreId] = useState(
    () => resolveStoreId(localStorage.getItem("xandora_store_id"))
  );
  const [companyView, setCompanyView] = useState(() =>
    String(localStorage.getItem("xandora_company_view") || "").trim()
  );

  const [devices, setDevices] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [draftsById, setDraftsById] = useState({});
  const [expandedById, setExpandedById] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [addingReader, setAddingReader] = useState(false);
  const [showAddReader, setShowAddReader] = useState(false);
  const [newReader, setNewReader] = useState({
    device_id: "",
    name: "",
    section_profile: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isGlobalMasterView = isMasterAdmin && !companyView;

  const profileMap = useMemo(() => {
    const map = new Map();
    for (const p of profiles) {
      const id = String(p?.id || "")
        .trim()
        .toUpperCase();
      if (id) map.set(id, p);
    }
    return map;
  }, [profiles]);

  function patchDraft(deviceId, patch) {
    setDraftsById((prev) => {
      const existing = prev[deviceId] || toDraft({});
      const next = typeof patch === "function" ? patch(existing) : { ...existing, ...patch };
      return { ...prev, [deviceId]: next };
    });
  }

  function toggleExpanded(deviceId) {
    setExpandedById((prev) => ({
      ...prev,
      [deviceId]: !prev[deviceId],
    }));
  }

  function applyProfileToDraft(deviceId, nextProfileId) {
    const profile = profileMap.get(nextProfileId);
    patchDraft(deviceId, (curr) => {
      const next = {
        ...curr,
        section_profile: nextProfileId,
        apply_profile_defaults: true,
      };
      if (profile?.default_alert_rules) {
        next.alert_rules = normalizeAlertRules(profile.default_alert_rules);
      }
      if (profile?.default_zone_role) {
        next.antennas = normalizeAntennas(curr.antennas).map((a) => ({
          ...a,
          zone_role: toRole(profile.default_zone_role),
        }));
      }
      return next;
    });
  }

  function addAntenna(deviceId) {
    patchDraft(deviceId, (curr) => {
      const antennas = normalizeAntennas(curr.antennas);
      const newId = nextAntennaId(antennas);
      const profile = profileMap.get(String(curr.section_profile || "").toUpperCase());

      antennas.push({
        antenna_id: newId,
        name: `Antenna ${newId}`,
        zone_role: toRole(profile?.default_zone_role),
        enabled: true,
        status: "never_seen",
        reads_30d: 0,
        last_seen_at: null,
      });

      return { ...curr, antennas: normalizeAntennas(antennas) };
    });
  }

  function removeAntenna(deviceId, antennaId) {
    patchDraft(deviceId, (curr) => ({
      ...curr,
      antennas: normalizeAntennas(curr.antennas).filter(
        (a) => Number(a.antenna_id) !== Number(antennaId)
      ),
    }));
  }

  async function load(activeStoreId) {
    const sid = resolveStoreId(activeStoreId || storeId);
    setLoading(true);
    setError("");
    setNotice("");

    if (isGlobalMasterView) {
      setDevices([]);
      setDraftsById({});
      setProfiles(FALLBACK_SECTION_PROFILES);
      setLoading(false);
      return;
    }

    try {
      let devicesRes;
      try {
        devicesRes = await withTimeout(
          apiGet(`/devices/health?store_id=${encodeURIComponent(sid)}`),
          4500,
          "/devices/health"
        );
      } catch (e) {
        const status = Number(e?.status || 0);
        const timedOut =
          e?.name === "TimeoutError" || /timeout/i.test(String(e?.message || ""));
        if (status === 404 || status >= 500 || timedOut) {
          devicesRes = await apiGet(`/devices?store_id=${encodeURIComponent(sid)}`);
        } else {
          throw e;
        }
      }

      let loadedProfiles = FALLBACK_SECTION_PROFILES;
      try {
        const profilesRes = await withTimeout(
          apiGet("/devices/section-profiles"),
          2500,
          "/devices/section-profiles"
        );
        if (Array.isArray(profilesRes?.profiles) && profilesRes.profiles.length > 0) {
          loadedProfiles = profilesRes.profiles;
        }
      } catch (e) {
        const status = Number(e?.status || 0);
        const timedOut =
          e?.name === "TimeoutError" || /timeout/i.test(String(e?.message || ""));
        if (status !== 404 && !timedOut) {
          console.warn("[devices] section profiles fallback:", e?.message || e);
        }
      }

      const loadedDevicesRaw = Array.isArray(devicesRes?.devices) ? devicesRes.devices : [];
      const loadedDevices = loadedDevicesRaw
        .map(shapeDeviceRow)
        .filter((d) => Boolean(d.device_id));

      const nextDrafts = {};
      for (const d of loadedDevices) {
        const draft = toDraft(d);
        if (!draft.section_profile) {
          draft.section_profile = inferProfile(d, loadedProfiles);
        }
        nextDrafts[d.device_id] = draft;
      }

      setProfiles(loadedProfiles);
      setDevices(loadedDevices);
      setDraftsById(nextDrafts);
    } catch (e) {
      console.error(e);
      setError(e?.error || e?.message || "Failed to load devices");
      setDevices([]);
      setProfiles(FALLBACK_SECTION_PROFILES);
      setDraftsById({});
    } finally {
      setLoading(false);
    }
  }

  async function addReader() {
    const deviceId = normalizeDeviceId(newReader.device_id);
    if (!deviceId) {
      setError("Reader ID is required");
      return;
    }

    setAddingReader(true);
    setError("");
    setNotice("");

    try {
      const sectionProfile = String(newReader.section_profile || "")
        .trim()
        .toUpperCase();
      const profile = profileMap.get(sectionProfile);
      const metadata =
        sectionProfile
          ? {
              section_profile: sectionProfile,
              device_zones: {
                section_profile: sectionProfile,
                alert_rules: normalizeAlertRules(
                  profile?.default_alert_rules || DEFAULT_ALERT_RULES
                ),
                antennas: [],
              },
            }
          : {};

      await apiPost("/devices/register", {
        device_id: deviceId,
        name: String(newReader.name || "").trim() || null,
        store_id: storeId,
        metadata,
      });

      setNewReader({ device_id: "", name: "", section_profile: "" });
      setShowAddReader(false);
      setNotice(`Reader ${deviceId} added`);
      await load(storeId);
      setExpandedById((prev) => ({ ...prev, [deviceId]: true }));
    } catch (e) {
      console.error(e);
      setError(e?.error || "Failed to add reader");
    } finally {
      setAddingReader(false);
    }
  }

  async function saveDevice(device) {
    const deviceId = String(device?.device_id || "");
    const draft = draftsById[deviceId];
    if (!deviceId || !draft) return;

    setSavingId(deviceId);
    setError("");
    setNotice("");

    try {
      await apiPut(`/devices/${encodeURIComponent(deviceId)}/config`, {
        name: draft.name,
        store_id: device?.store_id || storeId,
        section_profile: draft.section_profile || null,
        apply_profile_defaults: draft.apply_profile_defaults !== false,
        alert_rules: normalizeAlertRules(draft.alert_rules),
        antennas: normalizeAntennas(draft.antennas).map((a) => ({
          antenna_id: a.antenna_id,
          name: a.name,
          zone_role: toRole(a.zone_role),
          enabled: a.enabled !== false,
        })),
      });

      setNotice(`Saved ${deviceId}`);
      await load(storeId);
    } catch (e) {
      console.error(e);
      setError(e?.error || `Failed to save ${deviceId}`);
    } finally {
      setSavingId("");
    }
  }

  async function deleteDevice(device) {
    const deviceId = String(device?.device_id || "").trim();
    if (!deviceId) return;

    const ok = window.confirm(`Delete reader ${deviceId}? This cannot be undone.`);
    if (!ok) return;

    setDeletingId(deviceId);
    setError("");
    setNotice("");

    try {
      await apiDelete(`/devices/${encodeURIComponent(deviceId)}`);
      setNotice(`Deleted ${deviceId}`);
      setExpandedById((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
      await load(storeId);
    } catch (e) {
      console.error(e);
      if (Number(e?.status) === 404) {
        setError(
          "Delete route not available on the running backend. Restart backend and try again."
        );
      } else {
        setError(e?.error || `Failed to delete ${deviceId}`);
      }
    } finally {
      setDeletingId("");
    }
  }

  useEffect(() => {
    function onStoreChanged() {
      const sid = resolveStoreId(localStorage.getItem("xandora_store_id"));
      const nextCompanyView = String(
        localStorage.getItem("xandora_company_view") || ""
      ).trim();
      setCompanyView(nextCompanyView);
      setStoreId(sid);
      setShowAddReader(false);
      setExpandedById({});
      load(sid);
    }

    // Sync immediately so we don't miss an early store change event from Layout.
    onStoreChanged();
    window.addEventListener("xandora_store_changed", onStoreChanged);
    window.addEventListener("storage", onStoreChanged);
    return () => {
      window.removeEventListener("xandora_store_changed", onStoreChanged);
      window.removeEventListener("storage", onStoreChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGlobalMasterView]);

  return (
    <div className="glass p-6 rounded-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Devices</h1>
          <div className="text-xs opacity-70">
            {isGlobalMasterView
              ? "Global view: customer device details are hidden."
              : `Store context: ${storeId}`}
          </div>
        </div>

        {!isGlobalMasterView && (
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddReader((v) => !v)}
            className="text-xs px-3 py-2 rounded-md border border-cyan-500/50 hover:bg-cyan-500/10"
          >
            {showAddReader ? "Close" : "+ Add Reader"}
          </button>
          <button
            type="button"
            onClick={() => load(storeId)}
            className="text-xs px-3 py-2 rounded-md border border-slate-500/40 hover:bg-slate-500/10"
          >
            Refresh
          </button>
          </div>
        )}
      </div>

      {isGlobalMasterView && (
        <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-300">
          Switch to a company view or login as that customer admin to manage/view devices.
        </div>
      )}

      {!isGlobalMasterView && showAddReader && (
        <div className="border border-slate-500/30 rounded-lg p-3 grid grid-cols-1 lg:grid-cols-4 gap-3">
          <label className="text-xs space-y-1">
            <div className="opacity-70">Reader ID</div>
            <input
              value={newReader.device_id}
              onChange={(e) =>
                setNewReader((prev) => ({ ...prev, device_id: normalizeDeviceId(e.target.value) }))
              }
              placeholder="READER_EXIT_02"
              className="w-full px-3 py-2 rounded-md bg-slate-900/50 border border-slate-500/40 outline-none"
            />
          </label>
          <label className="text-xs space-y-1">
            <div className="opacity-70">Reader Name</div>
            <input
              value={newReader.name}
              onChange={(e) => setNewReader((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Security Exit Reader 2"
              className="w-full px-3 py-2 rounded-md bg-slate-900/50 border border-slate-500/40 outline-none"
            />
          </label>
          <label className="text-xs space-y-1">
            <div className="opacity-70">Section Profile</div>
            <select
              value={newReader.section_profile}
              onChange={(e) =>
                setNewReader((prev) => ({
                  ...prev,
                  section_profile: String(e.target.value || "").toUpperCase(),
                }))
              }
              className="w-full px-3 py-2 rounded-md bg-slate-900/50 border border-slate-500/40 outline-none"
            >
              <option value="">Select section</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs space-y-1">
            <div className="opacity-70">Action</div>
            <button
              type="button"
              onClick={addReader}
              disabled={addingReader}
              className="w-full px-3 py-2 rounded-md border border-emerald-500/50 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {addingReader ? "Adding..." : "Create Reader"}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="opacity-50">Loading...</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {notice && <div className="text-green-300 text-sm">{notice}</div>}

      <div className="overflow-x-auto border border-slate-500/30 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/40">
            <tr>
              <th className="text-left px-3 py-2">Reader ID</th>
              <th className="text-left px-3 py-2">Reader Name</th>
              <th className="text-left px-3 py-2">Section</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Last Seen</th>
              <th className="text-left px-3 py-2">Antennas</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && devices.length === 0 && (
              <tr>
                <td className="px-3 py-4 opacity-60" colSpan={7}>
                  {isGlobalMasterView
                    ? "Global view hidden. Switch to company/account view to see devices."
                    : "No devices found"}
                </td>
              </tr>
            )}
            {devices.map((d) => {
              const draft = draftsById[d.device_id] || toDraft(d);
              const selectedProfile = profileMap.get(
                String(draft.section_profile || "").toUpperCase()
              );
              const isExpanded = Boolean(expandedById[d.device_id]);

              return (
                <Fragment key={d.device_id}>
                  <tr className="border-t border-slate-500/20 align-top">
                    <td className="px-3 py-3 font-mono">{d.device_id}</td>
                    <td className="px-3 py-3 min-w-[140px] lg:min-w-[220px]">
                      <div className="space-y-2">
                        <input
                          value={draft.name}
                          onChange={(e) => patchDraft(d.device_id, { name: e.target.value })}
                          placeholder={`Reader ${d.device_id}`}
                          className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                        />
                        <div className="text-[10px] opacity-65">
                          {d.store_id || "No store"} | {String(d.device_type || "FIXED_READER").replaceAll("_", " ")}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 min-w-[120px] lg:min-w-[180px]">
                      <div className="space-y-2">
                        <select
                          value={draft.section_profile}
                          onChange={(e) =>
                            applyProfileToDraft(
                              d.device_id,
                              String(e.target.value || "").trim().toUpperCase()
                            )
                          }
                          className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                        >
                          <option value="">Select section</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] opacity-65">
                          {[d.location_label, d.zone_label].filter(Boolean).join(" | ") || "Location not assigned"}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex gap-1 flex-wrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border ${statusClass(d.status)}`}
                        >
                          {String(d.status || "unknown").toUpperCase()}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border ${readerOnlineClass(
                            d.reader_online
                          )}`}
                        >
                          {d.reader_online ? "Reader Online" : "Reader Offline"}
                        </span>
                        {d.lifecycle_state && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded border ${lifecycleClass(
                              d.lifecycle_state
                            )}`}
                          >
                            {d.lifecycle_state}
                          </span>
                        )}
                        {d.connectivity_state && (
                          <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/70">
                            {d.connectivity_state}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div>{timeAgo(d.last_seen)}</div>
                      <div className="text-[10px] opacity-65">
                        Heartbeat {timeAgo(d.last_heartbeat)}
                      </div>
                    </td>
                    <td className="px-3 py-3">{draft.antennas.length}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(d.device_id)}
                          className="px-2 py-1 rounded border border-slate-500/40 hover:bg-slate-500/10"
                        >
                          {isExpanded ? "Hide" : "Antennas"}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveDevice(d)}
                          disabled={savingId === d.device_id || deletingId === d.device_id}
                          className="px-2 py-1 rounded border border-cyan-500/50 hover:bg-cyan-500/10 disabled:opacity-50"
                        >
                          {savingId === d.device_id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDevice(d)}
                          disabled={deletingId === d.device_id || savingId === d.device_id}
                          className="px-2 py-1 rounded border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {deletingId === d.device_id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-t border-slate-500/20">
                      <td className="px-3 py-3 bg-slate-900/25" colSpan={7}>
                        <div className="space-y-3">
                          {selectedProfile?.description && (
                            <div className="text-xs opacity-70">
                              Section behavior: {selectedProfile.description}
                            </div>
                          )}

                          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                            <label className="text-xs flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.alert_rules.exit_unpaid_enabled}
                                onChange={(e) =>
                                  patchDraft(d.device_id, {
                                    alert_rules: {
                                      ...draft.alert_rules,
                                      exit_unpaid_enabled: e.target.checked,
                                    },
                                  })
                                }
                              />
                              <span>Unpaid exit alert</span>
                            </label>

                            <label className="text-xs flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.alert_rules.changing_room_dwell_enabled}
                                onChange={(e) =>
                                  patchDraft(d.device_id, {
                                    alert_rules: {
                                      ...draft.alert_rules,
                                      changing_room_dwell_enabled: e.target.checked,
                                    },
                                  })
                                }
                              />
                              <span>Changing-room dwell alert</span>
                            </label>

                            <label className="text-xs space-y-1">
                              <div className="opacity-70">Dwell minutes</div>
                              <input
                                type="number"
                                min={5}
                                max={240}
                                value={draft.alert_rules.changing_room_dwell_minutes}
                                onChange={(e) =>
                                  patchDraft(d.device_id, {
                                    alert_rules: {
                                      ...draft.alert_rules,
                                      changing_room_dwell_minutes: Math.min(
                                        Math.max(Number(e.target.value || 40), 5),
                                        240
                                      ),
                                    },
                                  })
                                }
                                className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                              />
                            </label>

                            <label className="text-xs space-y-1">
                              <div className="opacity-70">Apply defaults on save</div>
                              <select
                                value={draft.apply_profile_defaults ? "yes" : "no"}
                                onChange={(e) =>
                                  patchDraft(d.device_id, {
                                    apply_profile_defaults: e.target.value === "yes",
                                  })
                                }
                                className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                              >
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                          </div>

                          <div className="flex justify-between items-center">
                            <div className="text-xs opacity-70">
                              Configure only the antennas used by this reader.
                            </div>
                            <button
                              type="button"
                              onClick={() => addAntenna(d.device_id)}
                              className="text-xs px-3 py-1.5 rounded border border-emerald-500/50 hover:bg-emerald-500/10"
                            >
                              + Add Antenna
                            </button>
                          </div>

                          <div className="overflow-x-auto border border-slate-500/20 rounded-md">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-800/40">
                                <tr>
                                  <th className="text-left px-2 py-2">Antenna</th>
                                  <th className="text-left px-2 py-2">Name</th>
                                  <th className="text-left px-2 py-2">Zone Role</th>
                                  <th className="text-left px-2 py-2">Enabled</th>
                                  <th className="text-left px-2 py-2">Status</th>
                                  <th className="text-left px-2 py-2">Reads (30d)</th>
                                  <th className="text-left px-2 py-2">Last Seen</th>
                                  <th className="text-left px-2 py-2">Remove</th>
                                </tr>
                              </thead>
                              <tbody>
                                {draft.antennas.length === 0 && (
                                  <tr>
                                    <td className="px-2 py-3 opacity-60" colSpan={8}>
                                      No antennas configured. Click "+ Add Antenna".
                                    </td>
                                  </tr>
                                )}

                                {draft.antennas.map((a, idx) => (
                                  <tr
                                    key={`${d.device_id}-${a.antenna_id}`}
                                    className="border-t border-slate-500/20"
                                  >
                                    <td className="px-2 py-2">#{a.antenna_id}</td>
                                    <td className="px-2 py-2 min-w-[180px]">
                                      <input
                                        value={a.name}
                                        onChange={(e) =>
                                          patchDraft(d.device_id, (curr) => {
                                            const antennas = [...curr.antennas];
                                            antennas[idx] = {
                                              ...antennas[idx],
                                              name: e.target.value,
                                            };
                                            return { ...curr, antennas };
                                          })
                                        }
                                        className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                                      />
                                    </td>
                                    <td className="px-2 py-2 min-w-[170px]">
                                      <select
                                        value={a.zone_role}
                                        onChange={(e) =>
                                          patchDraft(d.device_id, (curr) => {
                                            const antennas = [...curr.antennas];
                                            antennas[idx] = {
                                              ...antennas[idx],
                                              zone_role: toRole(e.target.value),
                                            };
                                            return { ...curr, antennas };
                                          })
                                        }
                                        className="w-full px-2 py-1 rounded bg-slate-900/40 border border-slate-500/40 outline-none"
                                      >
                                        {ZONE_ROLE_OPTIONS.map((r) => (
                                          <option key={r.value} value={r.value}>
                                            {r.label}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="px-2 py-2">
                                      <label className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={a.enabled !== false}
                                          onChange={(e) =>
                                            patchDraft(d.device_id, (curr) => {
                                              const antennas = [...curr.antennas];
                                              antennas[idx] = {
                                                ...antennas[idx],
                                                enabled: e.target.checked,
                                              };
                                              return { ...curr, antennas };
                                            })
                                          }
                                        />
                                        <span>{a.enabled !== false ? "Yes" : "No"}</span>
                                      </label>
                                    </td>
                                    <td className="px-2 py-2 whitespace-nowrap">
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded border ${antennaStatusClass(
                                          a.status
                                        )}`}
                                      >
                                        {String(a.status || "unknown").toUpperCase()}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2">{a.reads_30d || 0}</td>
                                    <td className="px-2 py-2 whitespace-nowrap">
                                      {timeAgo(a.last_seen_at)}
                                    </td>
                                    <td className="px-2 py-2">
                                      <button
                                        type="button"
                                        onClick={() => removeAntenna(d.device_id, a.antenna_id)}
                                        className="px-2 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
