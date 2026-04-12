let deviceZoneReady = false;
let deviceZoneReadyPromise = null;

const DEFAULT_ALERT_RULES = {
  exit_unpaid_enabled: true,
  changing_room_dwell_enabled: true,
  changing_room_dwell_minutes: 40,
};

const SECTION_PROFILES = [
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

const ZONE_ROLE_ALIASES = {
  POS: "POS",
  EXIT: "EXIT",
  EXIT_GATE: "EXIT",
  ENTRANCE: "ENTRANCE",
  ENTRY: "ENTRANCE",
  CHANGING_ROOM: "CHANGING_ROOM",
  FITTING_ROOM: "CHANGING_ROOM",
  FITTING: "CHANGING_ROOM",
  SALES_FLOOR: "SALES_FLOOR",
  FLOOR: "SALES_FLOOR",
  BACKROOM: "BACKROOM",
  WAREHOUSE: "BACKROOM",
  UNASSIGNED: "UNASSIGNED",
};

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function normalizeZoneRole(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "UNASSIGNED";
  return ZONE_ROLE_ALIASES[raw] || "UNASSIGNED";
}

function normalizeAntennaId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function extractAntennaId(item = {}) {
  const source = asObject(item);
  return (
    normalizeAntennaId(source.antenna_id) ||
    normalizeAntennaId(source.antennaId) ||
    normalizeAntennaId(source.antenna) ||
    normalizeAntennaId(source.port) ||
    null
  );
}

function normalizeAntennaConfig(raw) {
  if (!Array.isArray(raw)) return [];

  const byId = new Map();
  for (const item of raw) {
    const obj = asObject(item);
    const antennaId = normalizeAntennaId(obj.antenna_id ?? obj.antennaId ?? obj.id);
    if (!antennaId) continue;

    const zoneRole = normalizeZoneRole(obj.zone_role ?? obj.zoneRole);
    const name = String(obj.name || obj.label || `Antenna ${antennaId}`).trim();

    byId.set(antennaId, {
      antenna_id: antennaId,
      name: name || `Antenna ${antennaId}`,
      zone_role: zoneRole,
      enabled: obj.enabled !== false,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.antenna_id - b.antenna_id);
}

function normalizeAlertRules(raw) {
  const obj = asObject(raw);
  return {
    exit_unpaid_enabled:
      typeof obj.exit_unpaid_enabled === "boolean"
        ? obj.exit_unpaid_enabled
        : DEFAULT_ALERT_RULES.exit_unpaid_enabled,
    changing_room_dwell_enabled:
      typeof obj.changing_room_dwell_enabled === "boolean"
        ? obj.changing_room_dwell_enabled
        : DEFAULT_ALERT_RULES.changing_room_dwell_enabled,
    changing_room_dwell_minutes: clamp(
      obj.changing_room_dwell_minutes ??
        DEFAULT_ALERT_RULES.changing_room_dwell_minutes,
      5,
      240
    ),
  };
}

function parseDeviceZoneConfig(metadata) {
  const safe = asObject(metadata);
  const zoneRoot = asObject(safe.device_zones);

  const antennaRaw = Array.isArray(zoneRoot.antennas)
    ? zoneRoot.antennas
    : Array.isArray(safe.antennas)
    ? safe.antennas
    : [];

  const alertRulesRaw = asObject(zoneRoot.alert_rules, safe.alert_rules || {});

  return {
    antennas: normalizeAntennaConfig(antennaRaw),
    alert_rules: normalizeAlertRules(alertRulesRaw),
  };
}

function mergeDeviceZoneConfig(metadata, config = {}) {
  const base = asObject(metadata);
  const parsed = parseDeviceZoneConfig(config);

  return {
    ...base,
    device_zones: {
      ...asObject(base.device_zones),
      antennas: parsed.antennas,
      alert_rules: parsed.alert_rules,
    },
  };
}

function getSectionProfiles() {
  return SECTION_PROFILES.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    default_alert_rules: normalizeAlertRules(p.default_alert_rules),
    default_zone_role: normalizeZoneRole(p.default_zone_role),
  }));
}

function getSectionProfile(profileId) {
  const key = String(profileId || "").trim().toUpperCase();
  return (
    SECTION_PROFILES.find((p) => p.id === key) || null
  );
}

function buildAntennaLookup(antennas = []) {
  const map = new Map();
  for (const row of normalizeAntennaConfig(antennas)) {
    map.set(row.antenna_id, row);
  }
  return map;
}

async function ensureDeviceZoneTables(pool) {
  if (deviceZoneReady) return;
  if (deviceZoneReadyPromise) {
    await deviceZoneReadyPromise;
    return;
  }

  deviceZoneReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zone_tag_events (
        id BIGSERIAL PRIMARY KEY,
        epc VARCHAR(255) NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        store_id VARCHAR(64),
        antenna_id INT,
        antenna_name TEXT,
        zone_role TEXT,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_tag_events_store_ts
      ON zone_tag_events (store_id, ts DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_tag_events_device_ant
      ON zone_tag_events (device_id, antenna_id, ts DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_tag_events_epc
      ON zone_tag_events (epc, ts DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS zone_tag_sessions (
        id BIGSERIAL PRIMARY KEY,
        epc VARCHAR(255) NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        store_id VARCHAR(64),
        zone_role TEXT NOT NULL,
        entered_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        exited_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_tag_sessions_store_status
      ON zone_tag_sessions (store_id, zone_role, status, last_seen_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_tag_sessions_epc
      ON zone_tag_sessions (epc, store_id, status)
    `);

    deviceZoneReady = true;
  })();

  try {
    await deviceZoneReadyPromise;
  } catch (err) {
    deviceZoneReadyPromise = null;
    throw err;
  }
}

module.exports = {
  DEFAULT_ALERT_RULES,
  normalizeZoneRole,
  normalizeAntennaId,
  extractAntennaId,
  normalizeAntennaConfig,
  normalizeAlertRules,
  parseDeviceZoneConfig,
  mergeDeviceZoneConfig,
  buildAntennaLookup,
  getSectionProfiles,
  getSectionProfile,
  ensureDeviceZoneTables,
};
