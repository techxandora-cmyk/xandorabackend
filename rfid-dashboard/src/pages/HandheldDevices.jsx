import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const MODULE_CONFIG = {
  laundry: {
    label: "Xandora Laundry",
    kicker: "Handheld devices",
    title: "Connect the handhelds used for pickup, wash flow, and dispatch.",
    summary:
      "Keep each handheld assigned to the right store and workflow so scan events arrive cleanly inside Xandora.",
    accentBorder: "border-cyan-500/18",
    accentBg:
      "bg-[linear-gradient(180deg,rgba(11,28,46,0.92),rgba(9,18,30,0.88))]",
    accentText: "text-cyan-200",
    accentPill: "border-cyan-500/35 bg-cyan-500/10 text-cyan-200",
    accentButton:
      "border-cyan-500/40 bg-[linear-gradient(90deg,rgba(140,17,231,0.95),rgba(22,249,243,0.9))] text-white shadow-[0_0_18px_rgba(140,17,231,0.25)] hover:brightness-105",
    managePermission: "dashboard.manage_laundry",
  },
  stock_audit: {
    label: "Xandora Stock Audit",
    kicker: "Handheld devices",
    title: "Connect the handhelds used for cycle counts and stock verification.",
    summary:
      "Give supervisors a clean view of what device is connected, what it belongs to, and how it is configured to sync.",
    accentBorder: "border-amber-500/18",
    accentBg:
      "bg-[linear-gradient(180deg,rgba(20,24,38,0.92),rgba(10,14,24,0.9))]",
    accentText: "text-amber-200",
    accentPill: "border-amber-500/35 bg-amber-500/10 text-amber-100",
    accentButton:
      "border-amber-500/40 bg-[linear-gradient(90deg,rgba(245,158,11,0.95),rgba(22,249,243,0.82))] text-slate-950 shadow-[0_0_18px_rgba(245,158,11,0.24)] hover:brightness-105",
    managePermission: "dashboard.manage_stock_audit",
  },
};

const CONNECTION_MODE_OPTIONS = [
  ["WIFI", "Wi-Fi"],
  ["CELLULAR", "Cellular"],
  ["USB_SYNC", "USB Sync"],
];

const SYNC_PROFILE_OPTIONS = [
  ["LIVE", "Live Sync"],
  ["BATCH", "Batch Sync"],
  ["OFFLINE_FIRST", "Offline First"],
];

function normalizeDeviceId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function timeAgo(value) {
  if (!value) return "Never seen";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "Unknown";
  const mins = Math.max(Math.floor(diff / 60000), 0);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function buildHandheldMetadata(draft, moduleKey) {
  return {
    module_scope: moduleKey,
    product_scope: moduleKey,
    device_kind: "HANDHELD",
    handheld: {
      module_scope: moduleKey,
      connection_mode: String(draft.connection_mode || "WIFI").trim().toUpperCase(),
      sync_profile: String(draft.sync_profile || "LIVE").trim().toUpperCase(),
      notes: String(draft.notes || "").trim(),
    },
    model: String(draft.model || "").trim(),
    serial_number: String(draft.serial_number || "").trim(),
    mac_address: String(draft.mac_address || "").trim(),
    firmware_version: String(draft.firmware_version || "").trim(),
  };
}

function shapeHandheldDevice(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const handheld =
    metadata?.handheld && typeof metadata.handheld === "object"
      ? metadata.handheld
      : {};
  const readerIdentity =
    row?.reader_identity && typeof row.reader_identity === "object"
      ? row.reader_identity
      : {};
  const moduleScope = String(
    metadata.module_scope || metadata.product_scope || handheld.module_scope || ""
  )
    .trim()
    .toLowerCase();
  const deviceKind = String(
    metadata.device_kind || metadata.device_type || handheld.device_kind || "HANDHELD"
  )
    .trim()
    .toUpperCase();
  const connected =
    String(row?.connectivity_state || "").trim().toUpperCase() === "ONLINE" ||
    String(row?.lifecycle_state || "").trim().toUpperCase() === "ONLINE" ||
    String(row?.status || "").trim().toLowerCase() === "online";

  return {
    device_id: String(row?.device_id || "").trim(),
    name: String(row?.name || row?.display_name || row?.device_id || "").trim(),
    store_id: String(row?.store_id || "").trim(),
    module_scope: moduleScope,
    device_kind: deviceKind,
    lifecycle_state: String(row?.lifecycle_state || "").trim().toUpperCase(),
    connectivity_state: String(row?.connectivity_state || "").trim().toUpperCase(),
    claimed: Boolean(row?.claimed),
    connected,
    last_seen: row?.last_seen || null,
    model: String(readerIdentity.model || metadata.model || "").trim(),
    serial_number: String(
      readerIdentity.serial_number || metadata.serial_number || ""
    ).trim(),
    mac_address: String(
      readerIdentity.mac_address || metadata.mac_address || ""
    ).trim(),
    firmware_version: String(
      readerIdentity.firmware_version || metadata.firmware_version || ""
    ).trim(),
    connection_mode: String(
      handheld.connection_mode || metadata.connection_mode || "WIFI"
    )
      .trim()
      .toUpperCase(),
    sync_profile: String(handheld.sync_profile || metadata.sync_profile || "LIVE")
      .trim()
      .toUpperCase(),
    notes: String(handheld.notes || metadata.notes || "").trim(),
  };
}

function toDraft(row) {
  return {
    device_id: String(row?.device_id || "").trim(),
    name: String(row?.name || "").trim(),
    model: String(row?.model || "").trim(),
    serial_number: String(row?.serial_number || "").trim(),
    mac_address: String(row?.mac_address || "").trim(),
    firmware_version: String(row?.firmware_version || "").trim(),
    connection_mode: String(row?.connection_mode || "WIFI").trim().toUpperCase(),
    sync_profile: String(row?.sync_profile || "LIVE").trim().toUpperCase(),
    notes: String(row?.notes || "").trim(),
  };
}

function statusTone(device) {
  if (device.connected) return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  if (device.claimed) return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  return "border-white/12 bg-white/5 text-white/75";
}

function Section({ title, subtitle, accent = false, children }) {
  return (
    <section
      className={`rounded-[28px] border p-5 ${
        accent ? "border-white/12 bg-black/25" : "border-white/10 bg-black/30"
      }`}
    >
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-white/72">{subtitle}</p> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function HandheldDevices({ moduleKey = "laundry" }) {
  const config = MODULE_CONFIG[moduleKey] || MODULE_CONFIG.laundry;
  const { hasPermission, isAdmin, isMasterAdmin } = useAuth();
  const canManage =
    isAdmin || isMasterAdmin || hasPermission(config.managePermission);

  const [storeId, setStoreId] = useState(
    () => localStorage.getItem("zyro_store_id") || "STORE_001"
  );
  const [devices, setDevices] = useState([]);
  const [draftsById, setDraftsById] = useState({});
  const [newDevice, setNewDevice] = useState({
    device_id: "",
    name: "",
    model: "",
    serial_number: "",
    mac_address: "",
    firmware_version: "",
    connection_mode: "WIFI",
    sync_profile: "LIVE",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadDevices = useCallback(async () => {
    const sid = String(storeId || "").trim();
    if (!sid) {
      setDevices([]);
      setDraftsById({});
      setError("Select a customer store before connecting handheld devices.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await apiGet(`/devices/health?store_id=${encodeURIComponent(sid)}`);
      const scoped = (Array.isArray(res?.devices) ? res.devices : [])
        .map(shapeHandheldDevice)
        .filter(
          (device) =>
            device.module_scope === moduleKey && device.device_kind === "HANDHELD"
        );

      const nextDrafts = {};
      scoped.forEach((device) => {
        nextDrafts[device.device_id] = toDraft(device);
      });

      setDevices(scoped);
      setDraftsById(nextDrafts);
    } catch (err) {
      console.error("[HandheldDevices] load failed:", err);
      setError(err?.error || err?.message || "Failed to load handheld devices");
      setDevices([]);
      setDraftsById({});
    } finally {
      setLoading(false);
    }
  }, [moduleKey, storeId]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    function onStoreChanged() {
      setStoreId(localStorage.getItem("zyro_store_id") || "");
    }
    window.addEventListener("zyro_store_changed", onStoreChanged);
    return () => window.removeEventListener("zyro_store_changed", onStoreChanged);
  }, []);

  function patchDraft(deviceId, patch) {
    setDraftsById((prev) => ({
      ...prev,
      [deviceId]: {
        ...(prev[deviceId] || {}),
        ...patch,
      },
    }));
  }

  async function createDevice(e) {
    e.preventDefault();
    if (!canManage) return;

    const normalizedDeviceId = normalizeDeviceId(newDevice.device_id);
    if (!normalizedDeviceId) {
      setError("Handheld device ID is required.");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");
    try {
      await apiPost("/devices/register", {
        device_id: normalizedDeviceId,
        name: String(newDevice.name || "").trim() || null,
        store_id: storeId,
        model: String(newDevice.model || "").trim() || null,
        serial_number: String(newDevice.serial_number || "").trim() || null,
        mac_address: String(newDevice.mac_address || "").trim() || null,
        firmware_version: String(newDevice.firmware_version || "").trim() || null,
        metadata: buildHandheldMetadata(
          {
            ...newDevice,
            device_id: normalizedDeviceId,
          },
          moduleKey
        ),
      });

      setNewDevice({
        device_id: "",
        name: "",
        model: "",
        serial_number: "",
        mac_address: "",
        firmware_version: "",
        connection_mode: "WIFI",
        sync_profile: "LIVE",
        notes: "",
      });
      setMessage(`Handheld ${normalizedDeviceId} connected.`);
      await loadDevices();
    } catch (err) {
      console.error("[HandheldDevices] create failed:", err);
      setError(err?.error || err?.message || "Failed to connect handheld device");
    } finally {
      setCreating(false);
    }
  }

  async function saveDevice(deviceId) {
    const draft = draftsById[deviceId];
    if (!draft) return;

    setSavingId(deviceId);
    setError("");
    setMessage("");
    try {
      await apiPut(`/devices/update/${encodeURIComponent(deviceId)}`, {
        name: String(draft.name || "").trim() || null,
        store_id: storeId,
        metadata: buildHandheldMetadata(draft, moduleKey),
      });
      setMessage(`Saved configuration for ${deviceId}.`);
      await loadDevices();
    } catch (err) {
      console.error("[HandheldDevices] save failed:", err);
      setError(err?.error || err?.message || `Failed to save ${deviceId}`);
    } finally {
      setSavingId("");
    }
  }

  async function removeDevice(deviceId) {
    if (!canManage) return;
    const ok = window.confirm(`Remove handheld ${deviceId}?`);
    if (!ok) return;

    setDeletingId(deviceId);
    setError("");
    setMessage("");
    try {
      await apiDelete(`/devices/${encodeURIComponent(deviceId)}`);
      setMessage(`Removed handheld ${deviceId}.`);
      await loadDevices();
    } catch (err) {
      console.error("[HandheldDevices] delete failed:", err);
      setError(err?.error || err?.message || `Failed to remove ${deviceId}`);
    } finally {
      setDeletingId("");
    }
  }

  const connectedCount = useMemo(
    () => devices.filter((device) => device.connected).length,
    [devices]
  );
  const claimedCount = useMemo(
    () => devices.filter((device) => device.claimed).length,
    [devices]
  );
  const needsSetupCount = useMemo(
    () =>
      devices.filter(
        (device) =>
          !device.claimed ||
          !device.serial_number ||
          !device.model ||
          !device.connection_mode
      ).length,
    [devices]
  );
  const checkedInTodayCount = useMemo(
    () =>
      devices.filter((device) => {
        if (!device.last_seen) return false;
        const diff = Date.now() - new Date(device.last_seen).getTime();
        return Number.isFinite(diff) && diff <= 24 * 60 * 60 * 1000;
      }).length,
    [devices]
  );
  const totalDevicesCount = devices.length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <section
        className={`rounded-[32px] border px-6 py-6 shadow-[0_26px_64px_rgba(3,10,20,0.28)] ${config.accentBorder} ${config.accentBg}`}
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${config.accentPill}`}
              >
                {config.label}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                {config.kicker}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
                Scan connectivity
              </span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {config.title}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/78">
              {config.summary}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-sm text-white/82">
                {totalDevicesCount.toLocaleString()} total devices
              </span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
                {connectedCount.toLocaleString()} connected now
              </span>
              <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-sm text-white/82">
                {checkedInTodayCount.toLocaleString()} seen today
              </span>
              {needsSetupCount ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
                  {needsSetupCount.toLocaleString()} need setup
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/12 bg-black/20 p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">Store scope</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {storeId || "No store selected"}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/72">
              Handhelds listed here are scoped to the selected customer store and this
              module only.
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/72">
              Register the handheld once, then keep only the connection details you
              actually need visible here.
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
        <Section
          title="Connect Handheld"
          subtitle="Start with the essentials. Advanced identity details can stay optional."
          accent
        >
          {canManage ? (
            <form onSubmit={createDevice} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <input
                  value={newDevice.device_id}
                  onChange={(e) =>
                    setNewDevice((prev) => ({ ...prev, device_id: e.target.value }))
                  }
                  placeholder="Handheld device ID"
                  className="brand-input font-mono"
                />
                <input
                  value={newDevice.name}
                  onChange={(e) =>
                    setNewDevice((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Display name"
                  className="brand-input"
                />
                <select
                  value={newDevice.connection_mode}
                  onChange={(e) =>
                    setNewDevice((prev) => ({
                      ...prev,
                      connection_mode: e.target.value,
                    }))
                  }
                  className="brand-input"
                >
                  {CONNECTION_MODE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value} className="bg-slate-100 text-slate-900">
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={newDevice.sync_profile}
                  onChange={(e) =>
                    setNewDevice((prev) => ({ ...prev, sync_profile: e.target.value }))
                  }
                  className="brand-input"
                >
                  {SYNC_PROFILE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value} className="bg-slate-100 text-slate-900">
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-white">
                  Advanced details
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <input
                    value={newDevice.model}
                    onChange={(e) =>
                      setNewDevice((prev) => ({ ...prev, model: e.target.value }))
                    }
                    placeholder="Device model"
                    className="brand-input"
                  />
                  <input
                    value={newDevice.serial_number}
                    onChange={(e) =>
                      setNewDevice((prev) => ({
                        ...prev,
                        serial_number: e.target.value,
                      }))
                    }
                    placeholder="Serial number"
                    className="brand-input"
                  />
                  <input
                    value={newDevice.mac_address}
                    onChange={(e) =>
                      setNewDevice((prev) => ({ ...prev, mac_address: e.target.value }))
                    }
                    placeholder="MAC / hardware ID"
                    className="brand-input"
                  />
                  <input
                    value={newDevice.firmware_version}
                    onChange={(e) =>
                      setNewDevice((prev) => ({
                        ...prev,
                        firmware_version: e.target.value,
                      }))
                    }
                    placeholder="Firmware version"
                    className="brand-input"
                  />
                </div>
                <textarea
                  value={newDevice.notes}
                  onChange={(e) =>
                    setNewDevice((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={3}
                  placeholder="Configuration notes"
                  className="brand-input mt-4"
                />
              </details>

              <button
                type="submit"
                disabled={creating}
                className={`rounded-xl border px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${config.accentButton}`}
              >
                {creating ? "Connecting..." : "Connect Handheld"}
              </button>
            </form>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/72">
              This account can monitor device status, but only a manager or admin can
              connect and configure handhelds.
            </div>
          )}
        </Section>

        <Section
          title="Quick Status"
          subtitle="A lighter view of what matters right now."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">
                Claimed
              </div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {claimedCount.toLocaleString()}
              </div>
              <div className="mt-2 text-sm text-white/72">
                Devices already assigned and ready to manage.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">
                Attention
              </div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {needsSetupCount.toLocaleString()}
              </div>
              <div className="mt-2 text-sm text-white/72">
                Devices still missing setup or identity details.
              </div>
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6">
        <Section
          title="Connected Handhelds"
          subtitle="See what device is connected, then expand only if you need more configuration."
        >
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
              Loading handheld devices...
            </div>
          ) : devices.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/60">
              No handheld devices are configured for this store and module yet.
            </div>
          ) : (
            <div className="space-y-4">
              {devices.map((device) => {
                const draft = draftsById[device.device_id] || toDraft(device);
                return (
                  <div
                    key={device.device_id}
                    className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-white">
                          {draft.name || device.device_id}
                        </div>
                        <div className="mt-1 font-mono text-xs text-white/55">
                          {device.device_id}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${statusTone(
                            device
                          )}`}
                        >
                          {device.connected
                            ? "Connected"
                            : device.claimed
                            ? "Configured"
                            : "Needs claim"}
                        </span>
                        <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/75">
                          Last seen {timeAgo(device.last_seen)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          patchDraft(device.device_id, { name: e.target.value })
                        }
                        placeholder="Display name"
                        className="brand-input"
                      />
                      <select
                        value={draft.connection_mode}
                        onChange={(e) =>
                          patchDraft(device.device_id, {
                            connection_mode: e.target.value,
                          })
                        }
                        className="brand-input"
                      >
                        {CONNECTION_MODE_OPTIONS.map(([value, label]) => (
                          <option
                            key={value}
                            value={value}
                            className="bg-slate-100 text-slate-900"
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={draft.sync_profile}
                        onChange={(e) =>
                          patchDraft(device.device_id, {
                            sync_profile: e.target.value,
                          })
                        }
                        className="brand-input"
                      >
                        {SYNC_PROFILE_OPTIONS.map(([value, label]) => (
                          <option
                            key={value}
                            value={value}
                            className="bg-slate-100 text-slate-900"
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/72">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/55">
                          Connection state
                        </div>
                        <div className="mt-2 font-medium text-white">
                          {device.connectivity_state || device.lifecycle_state || "UNKNOWN"}
                        </div>
                        <div className="mt-1 text-xs text-white/55">
                          Store {device.store_id || "-"}
                        </div>
                      </div>
                    </div>

                    <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      <summary className="cursor-pointer list-none text-sm font-medium text-white">
                        Advanced configuration
                      </summary>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <input
                          value={draft.model}
                          onChange={(e) =>
                            patchDraft(device.device_id, { model: e.target.value })
                          }
                          placeholder="Device model"
                          className="brand-input"
                        />
                        <input
                          value={draft.serial_number}
                          onChange={(e) =>
                            patchDraft(device.device_id, {
                              serial_number: e.target.value,
                            })
                          }
                          placeholder="Serial number"
                          className="brand-input"
                        />
                        <input
                          value={draft.mac_address}
                          onChange={(e) =>
                            patchDraft(device.device_id, {
                              mac_address: e.target.value,
                            })
                          }
                          placeholder="MAC / hardware ID"
                          className="brand-input"
                        />
                        <input
                          value={draft.firmware_version}
                          onChange={(e) =>
                            patchDraft(device.device_id, {
                              firmware_version: e.target.value,
                            })
                          }
                          placeholder="Firmware version"
                          className="brand-input"
                        />
                      </div>
                      <textarea
                        value={draft.notes}
                        onChange={(e) =>
                          patchDraft(device.device_id, { notes: e.target.value })
                        }
                        rows={3}
                        placeholder="Configuration notes"
                        className="brand-input mt-4"
                      />
                    </details>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => saveDevice(device.device_id)}
                        disabled={!canManage || savingId === device.device_id}
                        className={`rounded-xl border px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${config.accentButton}`}
                      >
                        {savingId === device.device_id ? "Saving..." : "Save Configuration"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDevice(device.device_id)}
                        disabled={!canManage || deletingId === device.device_id}
                        className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                      >
                        {deletingId === device.device_id ? "Removing..." : "Remove Device"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
