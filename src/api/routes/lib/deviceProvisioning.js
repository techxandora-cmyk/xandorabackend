const PROVISIONING_STATES = Object.freeze({
  UNCLAIMED: "UNCLAIMED",
  CLAIMED: "CLAIMED",
});

const CONNECTIVITY_STATES = Object.freeze({
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  UNKNOWN: "UNKNOWN",
});

const LIFECYCLE_STATES = Object.freeze({
  UNCLAIMED: "UNCLAIMED",
  CLAIMED: "CLAIMED",
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
});

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function normalizeText(value) {
  const out = String(value || "").trim();
  return out || null;
}

function normalizeStoreId(value) {
  const out = normalizeText(value);
  return out ? out.toUpperCase() : null;
}

function normalizeEmail(value) {
  const out = normalizeText(value);
  return out ? out.toLowerCase() : null;
}

function normalizeInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeHeartbeatMinutes(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), 1), 60);
}

function normalizeMacAddress(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  if (raw.length !== 12) return null;
  return raw.match(/.{1,2}/g).join(":");
}

function normalizeProvisioningIdentifiers(raw = {}) {
  const src = asObject(raw);

  const serialNumber = normalizeText(
    src.serial_number ||
      src.serialNo ||
      src.reader_serial_number ||
      src.device_serial ||
      src.serial
  );
  const macAddress = normalizeMacAddress(
    src.mac_address || src.reader_mac || src.mac || src.macAddress
  );
  const model = normalizeText(src.model || src.reader_model || src.device_model);
  const firmwareVersion = normalizeText(
    src.firmware_version || src.firmware || src.fw_version
  );

  const out = {};
  if (serialNumber) out.serial_number = serialNumber.toUpperCase();
  if (macAddress) out.mac_address = macAddress;
  if (model) out.model = model;
  if (firmwareVersion) out.firmware_version = firmwareVersion;
  return out;
}

function buildClaimProvisioningPatch(input = {}) {
  const at = normalizeTimestamp(input.at || new Date().toISOString()) || new Date().toISOString();
  return {
    state: PROVISIONING_STATES.CLAIMED,
    claimed: true,
    claimed_at: at,
    claimed_by_user_id: normalizeInt(input.user_id),
    claimed_by_email: normalizeEmail(input.email),
    claimed_store_id: normalizeStoreId(input.store_id),
    claim_source: normalizeText(input.source || "ADMIN_CONFIG"),
  };
}

function mergeDeviceProvisioningMetadata(metadata, patch = {}) {
  const base = asObject(metadata);
  const root = asObject(base.provisioning);
  const patchObj = asObject(patch);

  const existingIdentifiers = normalizeProvisioningIdentifiers(
    asObject(root.identifiers, root)
  );
  const patchIdentifiers = normalizeProvisioningIdentifiers(
    asObject(patchObj.identifiers, patchObj)
  );
  const identifiers = {
    ...existingIdentifiers,
    ...patchIdentifiers,
  };

  const claimedFromRoot =
    typeof root.claimed === "boolean"
      ? root.claimed
      : String(root.state || "").toUpperCase() === PROVISIONING_STATES.CLAIMED;
  const claimed =
    typeof patchObj.claimed === "boolean" ? patchObj.claimed : claimedFromRoot;
  const state = claimed
    ? PROVISIONING_STATES.CLAIMED
    : PROVISIONING_STATES.UNCLAIMED;

  const nextProvisioning = {
    ...root,
    state,
    claimed,
    claimed_at:
      normalizeTimestamp(patchObj.claimed_at) ||
      normalizeTimestamp(root.claimed_at) ||
      null,
    claimed_by_user_id:
      normalizeInt(patchObj.claimed_by_user_id) ??
      normalizeInt(root.claimed_by_user_id),
    claimed_by_email:
      normalizeEmail(patchObj.claimed_by_email) || normalizeEmail(root.claimed_by_email),
    claimed_store_id:
      normalizeStoreId(patchObj.claimed_store_id) ||
      normalizeStoreId(root.claimed_store_id),
    claim_source:
      normalizeText(patchObj.claim_source) || normalizeText(root.claim_source),
    identifiers,
  };

  return {
    ...base,
    provisioning: nextProvisioning,
  };
}

function parseDeviceProvisioning(row = {}, options = {}) {
  const heartbeatMinutes = normalizeHeartbeatMinutes(
    options.heartbeat_minutes ?? options.heartbeatMinutes,
    3
  );
  const nowMs = Number(options.now_ms || options.nowMs || Date.now());
  const metadata = asObject(row.metadata);
  const root = asObject(metadata.provisioning);

  const explicitClaimed =
    typeof root.claimed === "boolean"
      ? root.claimed
      : String(root.state || "").toUpperCase() === PROVISIONING_STATES.CLAIMED
      ? true
      : null;

  const legacyClaimHint = Boolean(
    normalizeStoreId(row.store_id) ||
      normalizeText(metadata.section_profile) ||
      normalizeText(asObject(metadata.device_zones).section_profile) ||
      normalizeTimestamp(root.claimed_at) ||
      normalizeText(root.claimed_by_email) ||
      normalizeInt(root.claimed_by_user_id) != null
  );

  const claimed =
    explicitClaimed != null ? explicitClaimed : legacyClaimHint;
  const provisioningState = claimed
    ? PROVISIONING_STATES.CLAIMED
    : PROVISIONING_STATES.UNCLAIMED;

  const statusRaw = String(row.status || "").trim().toLowerCase();
  const lastSeenIso = normalizeTimestamp(row.last_seen);
  const lastSeenMs = lastSeenIso ? new Date(lastSeenIso).getTime() : 0;
  const heartbeatMs = heartbeatMinutes * 60 * 1000;
  const online =
    statusRaw === "online" && lastSeenMs > 0 && nowMs - lastSeenMs <= heartbeatMs;

  let connectivityState = CONNECTIVITY_STATES.UNKNOWN;
  if (online) {
    connectivityState = CONNECTIVITY_STATES.ONLINE;
  } else if (
    lastSeenMs > 0 ||
    statusRaw === "online" ||
    statusRaw === "offline"
  ) {
    connectivityState = CONNECTIVITY_STATES.OFFLINE;
  }

  let lifecycleState = LIFECYCLE_STATES.UNCLAIMED;
  if (provisioningState === PROVISIONING_STATES.CLAIMED) {
    if (connectivityState === CONNECTIVITY_STATES.ONLINE) {
      lifecycleState = LIFECYCLE_STATES.ONLINE;
    } else if (connectivityState === CONNECTIVITY_STATES.OFFLINE) {
      lifecycleState = LIFECYCLE_STATES.OFFLINE;
    } else {
      lifecycleState = LIFECYCLE_STATES.CLAIMED;
    }
  }

  const identifiers = normalizeProvisioningIdentifiers(
    asObject(root.identifiers, root)
  );

  return {
    provisioning_state: provisioningState,
    connectivity_state: connectivityState,
    lifecycle_state: lifecycleState,
    claimed: provisioningState === PROVISIONING_STATES.CLAIMED,
    provisioning: {
      state: provisioningState,
      claimed: provisioningState === PROVISIONING_STATES.CLAIMED,
      claimed_at: normalizeTimestamp(root.claimed_at),
      claimed_by_user_id: normalizeInt(root.claimed_by_user_id),
      claimed_by_email: normalizeEmail(root.claimed_by_email),
      claimed_store_id:
        normalizeStoreId(root.claimed_store_id) || normalizeStoreId(row.store_id),
      claim_source: normalizeText(root.claim_source),
      identifiers,
    },
    connectivity: {
      state: connectivityState,
      online,
      heartbeat_minutes: heartbeatMinutes,
      last_seen: lastSeenIso,
    },
    reader_identity: identifiers,
  };
}

module.exports = {
  PROVISIONING_STATES,
  CONNECTIVITY_STATES,
  LIFECYCLE_STATES,
  normalizeProvisioningIdentifiers,
  mergeDeviceProvisioningMetadata,
  buildClaimProvisioningPatch,
  parseDeviceProvisioning,
};
