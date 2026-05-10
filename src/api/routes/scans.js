// src/api/routes/scans.js
const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("./lib/catalogTable");
const { writeAuditLog } = require("./lib/audit");
const {
  ensureDeviceZoneTables,
  parseDeviceZoneConfig,
  extractAntennaId,
  normalizeZoneRole,
  normalizeAlertRules,
  getSectionProfile,
} = require("./lib/deviceZones");
const {
  normalizeTagValue,
  canExposeInternalUid,
  sanitizeTagRegistryRow,
  ensureTagRegistryTable,
  classifyTagState,
  loadTagRowsByEpc,
  touchTagRegistryRow,
  insertTagRegistryRow,
  hasMasterRole,
} = require("./lib/tagRegistry");
const {
  aggregateScanItems,
  batchMetrics,
  decideScanDisposition,
  normalizeStoreScope,
} = require("./lib/scanEngine");
const { validateRetailScan } = require("./lib/retailValidation");
const { upsertOperationalAlert } = require("./lib/operationalAlerts");

const AUTO_BRANDS = ["Xandora Basics", "UrbanPulse", "Northline", "AeroWeave", "NovaThread"];
const AUTO_CATEGORIES = ["T-Shirt", "Shirt"];
const AUTO_SIZES = ["XS", "S", "M", "L", "XL"];
const AUTO_COLORS = ["Black", "White", "Navy", "Olive", "Grey"];
const TAG_ACTION_LABELS = {
  already_available: "Already available",
  insert_as_new_tag: "Insert as new tag",
};
const RUNTIME_ALERT_TYPES = {
  EXIT_UNPAID: "EXIT_UNPAID",
  CHANGING_ROOM_DWELL: "CHANGING_ROOM_DWELL",
};
const RUNTIME_ALERT_SEVERITY = {
  EXIT_UNPAID: 85,
  CHANGING_ROOM_DWELL: 65,
};
const SCAN_STABILITY_THRESHOLD = Math.min(
  Math.max(Number(process.env.SCAN_STABILITY_THRESHOLD || 2), 1),
  20
);
const SCAN_DUPLICATE_WINDOW_MS = Math.min(
  Math.max(Number(process.env.SCAN_DUPLICATE_WINDOW_MS || 2500), 0),
  600000
);
const SCAN_MIN_RSSI = Number.isFinite(Number(process.env.SCAN_MIN_RSSI))
  ? Number(process.env.SCAN_MIN_RSSI)
  : null;
const AUTO_CREATE_CATALOG_FROM_SCANS =
  String(process.env.AUTO_CREATE_CATALOG_FROM_SCANS || "1").trim() !== "0";

module.exports = function buildScanRoutes(pool) {
  const router = express.Router();
  const expectedScanKey = process.env.SCAN_API_KEY || "xandora_reader_001";
  const { lookupScanToken } = require("./lib/scanTokens");
  let alertColumnsCache = null;
  let alertColumnsCacheTs = 0;
  let alertsUpdatedAtEnsureAttempted = false;
  const runtimeAlertTouchAt = new Map();
  const changingRoomSweepAtByStore = new Map();
  const ALERT_TOUCH_WINDOW_MS = Math.min(
    Math.max(Number(process.env.RUNTIME_ALERT_TOUCH_WINDOW_MS || 5000), 500),
    120000
  );
  const CHANGING_ROOM_SWEEP_WINDOW_MS = Math.min(
    Math.max(Number(process.env.RUNTIME_CHANGING_SWEEP_MS || 15000), 1000),
    300000
  );
  const RUNTIME_ALERT_REPEAT_UPDATE_ENABLED =
    String(process.env.RUNTIME_ALERT_REPEAT_UPDATE_ENABLED || "0").trim() === "1";
  const RUNTIME_DB_LOCK_TIMEOUT_MS = Math.min(
    Math.max(Number(process.env.RUNTIME_DB_LOCK_TIMEOUT_MS || 120), 50),
    2000
  );
  const RUNTIME_ALERTS_ENABLED =
    String(process.env.RUNTIME_ALERTS_ENABLED || "1").trim() !== "0";

  /* =========================
     AUTH (Dashboard JWT)
  ========================= */
  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  async function allowJwtOrScanKey(req, res, next) {
    const auth = req.headers.authorization;

    if (auth && auth.startsWith("Bearer ")) {
      try {
        req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
        return next();
      } catch {
        return res.status(401).json({ ok: false, error: "Invalid token" });
      }
    }

    const key =
      req.headers["x-scan-key"] ||
      req.headers["x-api-key"] ||
      req.headers["x-xandora-scan-key"];

    if (!key) {
      return res.status(403).json({ ok: false, error: "Forbidden (scan key required)" });
    }

    // Token-based auth (st_ / ct_ prefix): validate against DB
    if (key.startsWith("st_") || key.startsWith("ct_")) {
      const tokenRow = await lookupScanToken(pool, key).catch(() => null);
      if (!tokenRow || !tokenRow.is_active) {
        return res.status(403).json({ ok: false, error: "Forbidden (invalid scan token)" });
      }
      // Attach resolved context so downstream handlers can use it
      req.scanToken = tokenRow;
      return next();
    }

    // Legacy env-var key fallback
    if (key !== expectedScanKey) {
      return res.status(403).json({ ok: false, error: "Forbidden (scan key required)" });
    }

    return next();
  }

  function isAdminUser(req) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function hasPermission(req, permission) {
    const permissions = Array.isArray(req.user?.permissions)
      ? req.user.permissions
      : [];

    return permissions.includes("*") || permissions.includes(permission);
  }

  function canAccessStore(req, store_id) {
    if (!store_id) return false;
    if (isAdminUser(req)) return true;

    const allowedStores = Array.isArray(req.user?.store_ids)
      ? req.user.store_ids
      : [];

    return allowedStores.includes(store_id);
  }

  function canUseTagIntake(req, store_id) {
    if (!canAccessStore(req, store_id)) return false;
    if (isAdminUser(req)) return true;
    return hasPermission(req, "handheld.scan_items");
  }

  function normalizeDecision(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getTagUiActions(actions = []) {
    return actions.map((action) => ({
      id: action,
      label: TAG_ACTION_LABELS[action] || action,
    }));
  }

  function resolveCompanyScope(req) {
    const companyName = String(req.user?.company_name || "").trim();
    return companyName || null;
  }

  function toTagCheckResponse({
    epc,
    tid,
    storeId,
    tagState,
    includeInternalUid,
  }) {
    const existingTag = tagState.exact || tagState.latest || null;

    return {
      ok: true,
      epc,
      tid,
      store_id: storeId,
      status: tagState.status,
      action_required: tagState.action_required,
      allowed_actions: tagState.allowed_actions,
      ui_actions: getTagUiActions(tagState.allowed_actions),
      existing_count_by_epc: tagState.total_epc_rows,
      existing_tag: sanitizeTagRegistryRow(existingTag, { includeInternalUid }),
      duplicate_examples: tagState.duplicates
        .slice(0, 5)
        .map((row) =>
          sanitizeTagRegistryRow(row, { includeInternalUid })
        ),
      internal_uid_visible: includeInternalUid,
    };
  }

  /* =========================
     INVENTORY HELPER
  ========================= */
  async function getActiveInventorySession(client, store_id) {
    if (!store_id) return null;

    const r = await client.query(
      `
      SELECT *
      FROM inventory_sessions
      WHERE store_id = $1
        AND status = 'ACTIVE'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [store_id]
    );

    return r.rowCount ? r.rows[0] : null;
  }

  async function getActiveBillingSession(client, store_id) {
    if (!store_id) return null;

    const r = await client.query(
      `
      SELECT *
      FROM billing_sessions
      WHERE store_id = $1
        AND status = 'ACTIVE'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [store_id]
    );

    return r.rowCount ? r.rows[0] : null;
  }

  function mergeAverageRssi(previous, incoming) {
    const prevReads = Math.max(Number(previous?.read_count || 0), 0);
    const nextReads = Math.max(Number(incoming?.observation_count || 0), 0);
    const prevAverage = Number(previous?.average_rssi);
    const nextAverage = Number(incoming?.average_rssi);

    if (!Number.isFinite(prevAverage) && !Number.isFinite(nextAverage)) {
      return null;
    }

    if (!Number.isFinite(prevAverage)) {
      return Number.isFinite(nextAverage) ? Number(nextAverage.toFixed(2)) : null;
    }

    if (!Number.isFinite(nextAverage) || nextReads <= 0) {
      return Number(prevAverage.toFixed(2));
    }

    const totalReads = Math.max(prevReads + nextReads, 1);
    return Number(
      (((prevAverage * prevReads) + (nextAverage * nextReads)) / totalReads).toFixed(2)
    );
  }

  async function trackBillingValidationAlert(client, storeId, validation, scanPayload = {}) {
    const typeByStatus = {
      UNKNOWN_EPC: "UNKNOWN_EPC_DETECTED",
      ALREADY_BILLED: "ITEM_ALREADY_BILLED",
      VALIDATION_FAILED: "VALIDATION_SERVICE_UNAVAILABLE",
      DUPLICATE: "DUPLICATE_SCAN_BEHAVIOR",
    };

    const alertType = typeByStatus[String(validation?.validation_status || "").toUpperCase()];
    if (!alertType) return null;

    const severityByStatus = {
      UNKNOWN_EPC: 55,
      ALREADY_BILLED: 80,
      VALIDATION_FAILED: 70,
      DUPLICATE: 35,
    };

    return upsertOperationalAlert(client, {
      type: alertType,
      entity_type: "BILLING_SCAN",
      entity_id: `${storeId}:${String(scanPayload.epc || "").trim().toUpperCase()}`,
      store_id: storeId,
      severity: severityByStatus[validation.validation_status] || 50,
      metadata: {
        epc: String(scanPayload.epc || "").trim().toUpperCase() || null,
        device_id: scanPayload.device_id || null,
        validation_status: validation.validation_status || null,
        validation_message: validation.validation_message || null,
        session_id: scanPayload.session_id || null,
      },
    });
  }

  function buildAutoCatalog(tag, store_id) {
    const cleanTag = String(tag || "").trim().toUpperCase();
    const tail = cleanTag.slice(-6) || "000000";

    const n = parseInt(tail, 16) || cleanTag.length;
    const brand = AUTO_BRANDS[n % AUTO_BRANDS.length];
    const category = AUTO_CATEGORIES[n % AUTO_CATEGORIES.length];
    const size_label = AUTO_SIZES[n % AUTO_SIZES.length];
    const color = AUTO_COLORS[n % AUTO_COLORS.length];
    const product_name =
      category === "T-Shirt"
        ? `${brand} Core Tee ${tail}`
        : `${brand} Smart Shirt ${tail}`;

    return {
      store_id,
      epc: cleanTag,
      sku: `SKU-${store_id}-${tail}`,
      product_name,
      brand,
      category,
      size_label,
      color,
      price_lkr: 2490 + (n % 8) * 200,
    };
  }

  function asObject(value, fallback = {}) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : fallback;
  }

  function normalizeStoreId(value) {
    const v = String(value || "").trim();
    return v || null;
  }

  function normalizeIncomingTag(value) {
    const v = String(value || "").trim();
    return v || null;
  }

  function parseScanTimestamp(value) {
    const ts = value ? new Date(value) : new Date();
    if (Number.isNaN(ts.getTime())) {
      return new Date();
    }
    return ts;
  }

  function buildUniqueScanMap(items = []) {
    const byTag = new Map();

    for (const raw of items) {
      const rawTag = typeof raw === "string" ? raw : raw?.tag;
      const tag = normalizeIncomingTag(rawTag);
      if (!tag) continue;

      const row =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw
          : { tag };

      const prev = byTag.get(tag);
      if (!prev) {
        byTag.set(tag, row);
        continue;
      }

      const prevTs = Date.parse(prev.ts || "");
      const nextTs = Date.parse(row.ts || "");
      if (Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs >= prevTs)) {
        byTag.set(tag, row);
      }
    }

    return byTag;
  }

  function getSectionProfileId(metadata) {
    const safe = asObject(metadata);
    const zoneRoot = asObject(safe.device_zones);
    return String(safe.section_profile || zoneRoot.section_profile || "")
      .trim()
      .toUpperCase();
  }

  function getEffectiveAlertRules(metadata, sectionProfile) {
    const safe = asObject(metadata);
    const zoneRoot = asObject(safe.device_zones);
    const explicitRules = asObject(zoneRoot.alert_rules, safe.alert_rules || null);

    if (explicitRules && Object.keys(explicitRules).length > 0) {
      return normalizeAlertRules(explicitRules);
    }

    if (sectionProfile?.default_alert_rules) {
      return normalizeAlertRules(sectionProfile.default_alert_rules);
    }

    return normalizeAlertRules({});
  }

  function isMissingUpdatedAtTriggerError(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "").toLowerCase();
    return (
      code === "42703" &&
      message.includes('record "new"') &&
      message.includes("updated_at")
    );
  }

  function isRetryableRuntimeLockError(err) {
    const code = String(err?.code || "");
    return code === "40P01" || code === "55P03";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function allowRuntimeAlertMutation(key, nowMs = Date.now()) {
    const k = String(key || "").trim();
    if (!k) return true;
    const prev = Number(runtimeAlertTouchAt.get(k) || 0);
    if (prev > 0 && nowMs - prev < ALERT_TOUCH_WINDOW_MS) {
      return false;
    }
    runtimeAlertTouchAt.set(k, nowMs);

    if (runtimeAlertTouchAt.size > 20000) {
      const cutoff = nowMs - ALERT_TOUCH_WINDOW_MS * 4;
      for (const [cacheKey, touchedAt] of runtimeAlertTouchAt.entries()) {
        if (Number(touchedAt || 0) < cutoff) {
          runtimeAlertTouchAt.delete(cacheKey);
        }
      }
    }

    return true;
  }

  async function tryRuntimeAlertKeyLock(client, input = {}) {
    const mode = String(input.mode || "open").trim().toLowerCase();
    const type = String(input.type || "").trim().toUpperCase();
    const entityType = String(input.entity_type || "TAG").trim().toUpperCase();
    const entityId = String(input.entity_id || "").trim();
    const storeId = normalizeStoreId(input.store_id);
    const key = [mode, type, entityType, entityId, String(storeId || "")].join("|");

    if (!type || !entityId) {
      return true;
    }

    try {
      const lockResult = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
        [key]
      );
      return Boolean(lockResult.rows?.[0]?.locked);
    } catch (err) {
      console.warn("[scans/runtime] advisory lock fallback:", err.message);
      return true;
    }
  }

  async function withRuntimeDeadlockRetry(client, label, work, maxAttempts = 2) {
    const savepoint = "runtime_alert_op";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work();
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (err) {
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {}

        if (!isRetryableRuntimeLockError(err) || attempt >= maxAttempts) {
          throw err;
        }

        const waitMs = 15 * attempt;
        console.warn(
          `[scans/runtime] lock contention in ${label}, retry ${attempt}/${maxAttempts} after ${waitMs}ms`
        );
        await sleep(waitMs);
      }
    }

    return work();
  }

  async function loadAlertColumns(client) {
    const r = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'alerts'
      `
    );
    return new Set(r.rows.map((row) => String(row.column_name || "")));
  }

  async function ensureAlertsUpdatedAtColumn(client, currentColumns = new Set()) {
    if (currentColumns.has("updated_at")) {
      return currentColumns;
    }
    if (alertsUpdatedAtEnsureAttempted) {
      return currentColumns;
    }

    alertsUpdatedAtEnsureAttempted = true;
    try {
      await client.query(`
        ALTER TABLE alerts
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);
      const refreshed = await loadAlertColumns(client);
      return refreshed.size > 0 ? refreshed : currentColumns;
    } catch (err) {
      console.warn(
        "[scans/runtime] failed to ensure alerts.updated_at compatibility:",
        err.message
      );
      return currentColumns;
    }
  }

  async function getAlertColumns(client, force = false) {
    if (!force && alertColumnsCache && Date.now() - alertColumnsCacheTs < 30000) {
      return alertColumnsCache;
    }

    try {
      let cols = await loadAlertColumns(client);
      cols = await ensureAlertsUpdatedAtColumn(client, cols);
      if (cols.size > 0) {
        alertColumnsCache = cols;
        alertColumnsCacheTs = Date.now();
        return cols;
      }
    } catch (err) {
      console.warn("[scans/runtime] alerts columns lookup failed:", err.message);
    }

    const fallback = new Set([
      "type",
      "entity_type",
      "entity_id",
      "store_id",
      "severity",
      "status",
      "created_at",
      "updated_at",
      "metadata",
      "first_detected_at",
      "last_detected_at",
      "resolved_at",
    ]);
    alertColumnsCache = fallback;
    alertColumnsCacheTs = Date.now();
    return fallback;
  }

  async function upsertRuntimeAlert(client, columns, input = {}) {
    if (!RUNTIME_ALERTS_ENABLED) {
      return { action: "disabled", alert: null };
    }

    try {
      return await withRuntimeDeadlockRetry(client, "upsertRuntimeAlert", async () => {
        const type = String(input.type || "").trim().toUpperCase();
        const entityType = String(input.entity_type || "TAG").trim().toUpperCase();
        const entityId = String(input.entity_id || "").trim();
        const storeId = normalizeStoreId(input.store_id);
        const severity = Math.min(Math.max(Number(input.severity) || 50, 1), 100);
        const metadata = asObject(input.metadata);
        const detectedAt = parseScanTimestamp(input.detected_at).toISOString();

        if (!type || !entityId) {
          return { action: "none", alert: null };
        }

        const touchKey = [
          "open",
          type,
          entityType,
          entityId,
          String(storeId || ""),
        ].join("|");
        if (!allowRuntimeAlertMutation(touchKey)) {
          return { action: "throttled", alert: null };
        }

        const keyLocked = await tryRuntimeAlertKeyLock(client, {
          mode: "open",
          type,
          entity_type: entityType,
          entity_id: entityId,
          store_id: storeId,
        });
        if (!keyLocked) {
          return { action: "deferred", alert: null };
        }

        const existing = await client.query(
          `
          SELECT *
          FROM alerts
          WHERE type = $1
            AND entity_type = $2
            AND entity_id = $3
            AND (store_id IS NOT DISTINCT FROM $4::varchar)
            AND status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
          `,
          [type, entityType, entityId, storeId]
        );

        if (existing.rowCount > 0) {
          if (!RUNTIME_ALERT_REPEAT_UPDATE_ENABLED) {
            return { action: "existing", alert: existing.rows[0] || null };
          }

          const setParts = [
            "severity = GREATEST(severity, $2::int)",
            "status = 'OPEN'",
          ];
          const values = [existing.rows[0].id, severity];
          let i = 3;

          if (columns.has("metadata")) {
            setParts.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${i++}::jsonb`);
            values.push(JSON.stringify(metadata));
          }

          if (columns.has("last_detected_at")) {
            setParts.push(`last_detected_at = $${i++}::timestamptz`);
            values.push(detectedAt);
          }

          if (columns.has("resolved_at")) {
            setParts.push("resolved_at = NULL");
          }

          if (columns.has("updated_at")) {
            setParts.push("updated_at = NOW()");
          }

          let updated;
          try {
            updated = await client.query(
              `
              UPDATE alerts
              SET ${setParts.join(", ")}
              WHERE id = $1
              RETURNING *
              `,
              values
            );
          } catch (err) {
            if (!isMissingUpdatedAtTriggerError(err)) {
              throw err;
            }
            await ensureAlertsUpdatedAtColumn(client, columns);
            alertColumnsCache = null;
            alertColumnsCacheTs = 0;
            updated = await client.query(
              `
              UPDATE alerts
              SET ${setParts.join(", ")}
              WHERE id = $1
              RETURNING *
              `,
              values
            );
          }

          return { action: "updated", alert: updated.rows[0] || null };
        }

        const fields = ["type", "entity_type", "entity_id", "store_id", "severity", "status"];
        const values = [type, entityType, entityId, storeId, severity, "OPEN"];

        if (columns.has("metadata")) {
          fields.push("metadata");
          values.push(JSON.stringify(metadata));
        }
        if (columns.has("first_detected_at")) {
          fields.push("first_detected_at");
          values.push(detectedAt);
        }
        if (columns.has("last_detected_at")) {
          fields.push("last_detected_at");
          values.push(detectedAt);
        }

        const placeholders = values.map((_, idx) => `$${idx + 1}`).join(", ");
        const inserted = await client.query(
          `
          INSERT INTO alerts (${fields.join(", ")})
          VALUES (${placeholders})
          RETURNING *
          `,
          values
        );

        return { action: "inserted", alert: inserted.rows[0] || null };
      });
    } catch (err) {
      if (isRetryableRuntimeLockError(err)) {
        console.warn("[scans/runtime] deferred upsertRuntimeAlert due lock contention");
        return { action: "deferred", alert: null };
      }
      throw err;
    }
  }

  async function resolveRuntimeAlert(client, columns, input = {}) {
    if (!RUNTIME_ALERTS_ENABLED) {
      return { action: "disabled", alert: null };
    }

    try {
      return await withRuntimeDeadlockRetry(client, "resolveRuntimeAlert", async () => {
        const type = String(input.type || "").trim().toUpperCase();
        const entityType = String(input.entity_type || "TAG").trim().toUpperCase();
        const entityId = String(input.entity_id || "").trim();
        const storeId = normalizeStoreId(input.store_id);
        const metadata = asObject(input.metadata);

        if (!type || !entityId) {
          return { action: "none", alert: null };
        }

        const touchKey = [
          "resolve",
          type,
          entityType,
          entityId,
          String(storeId || ""),
        ].join("|");
        if (!allowRuntimeAlertMutation(touchKey)) {
          return { action: "throttled", alert: null };
        }

        const keyLocked = await tryRuntimeAlertKeyLock(client, {
          mode: "resolve",
          type,
          entity_type: entityType,
          entity_id: entityId,
          store_id: storeId,
        });
        if (!keyLocked) {
          return { action: "deferred", alert: null };
        }

        const existing = await client.query(
          `
          SELECT id
          FROM alerts
          WHERE type = $1
            AND entity_type = $2
            AND entity_id = $3
            AND (store_id IS NOT DISTINCT FROM $4::varchar)
            AND status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
          `,
          [type, entityType, entityId, storeId]
        );

        if (existing.rowCount === 0) {
          return { action: "none", alert: null };
        }

        const setParts = ["status = 'RESOLVED'"];
        const values = [existing.rows[0].id];
        let i = 2;

        if (columns.has("resolved_at")) {
          setParts.push("resolved_at = NOW()");
        }
        if (columns.has("metadata")) {
          setParts.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${i++}::jsonb`);
          values.push(JSON.stringify(metadata));
        }
        if (columns.has("updated_at")) {
          setParts.push("updated_at = NOW()");
        }

        let resolved;
        try {
          resolved = await client.query(
            `
            UPDATE alerts
            SET ${setParts.join(", ")}
            WHERE id = $1
            RETURNING *
            `,
            values
          );
        } catch (err) {
          if (!isMissingUpdatedAtTriggerError(err)) {
            throw err;
          }
          await ensureAlertsUpdatedAtColumn(client, columns);
          alertColumnsCache = null;
          alertColumnsCacheTs = 0;
          resolved = await client.query(
            `
            UPDATE alerts
            SET ${setParts.join(", ")}
            WHERE id = $1
            RETURNING *
            `,
            values
          );
        }

        return { action: "resolved", alert: resolved.rows[0] || null };
      });
    } catch (err) {
      if (isRetryableRuntimeLockError(err)) {
        console.warn("[scans/runtime] deferred resolveRuntimeAlert due lock contention");
        return { action: "deferred", alert: null };
      }
      throw err;
    }
  }

  async function loadDeviceRuntimeConfig(client, deviceId, fallbackStoreId, cache = new Map()) {
    const key = String(deviceId || "").trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);

    const r = await client.query(
      `
      SELECT device_id, name, store_id, metadata
      FROM devices
      WHERE device_id = $1
      LIMIT 1
      `,
      [key]
    );

    const row = r.rows[0] || null;
    const metadata = asObject(row?.metadata);
    const sectionProfile = getSectionProfile(getSectionProfileId(metadata));
    const zoneCfg = parseDeviceZoneConfig(metadata);
    const antennaLookup = new Map();

    for (const antenna of zoneCfg.antennas || []) {
      const id = Number(antenna.antenna_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      antennaLookup.set(id, antenna);
    }

    const out = {
      device_id: key,
      name: row?.name || key,
      store_id: normalizeStoreId(row?.store_id || fallbackStoreId),
      section_profile: sectionProfile?.id || null,
      default_zone_role: normalizeZoneRole(sectionProfile?.default_zone_role),
      alert_rules: getEffectiveAlertRules(metadata, sectionProfile),
      antenna_lookup: antennaLookup,
    };

    cache.set(key, out);
    return out;
  }

  function resolveZoneContext(item, runtimeCfg) {
    const payload = asObject(item);
    const antennaId = extractAntennaId(payload);
    const configuredAntenna =
      antennaId && runtimeCfg?.antenna_lookup
        ? runtimeCfg.antenna_lookup.get(Number(antennaId))
        : null;

    let zoneRole = "UNASSIGNED";
    let antennaName = null;

    if (configuredAntenna && configuredAntenna.enabled !== false) {
      zoneRole = normalizeZoneRole(configuredAntenna.zone_role);
      antennaName = configuredAntenna.name || null;
    }

    if (zoneRole === "UNASSIGNED") {
      const payloadRole = normalizeZoneRole(
        payload.zone_role || payload.zoneRole || payload.antenna_role || payload.role
      );
      if (payloadRole !== "UNASSIGNED") {
        zoneRole = payloadRole;
      }
    }

    if (zoneRole === "UNASSIGNED") {
      zoneRole = normalizeZoneRole(runtimeCfg?.default_zone_role);
    }

    if (!antennaName && Number.isInteger(antennaId) && antennaId > 0) {
      antennaName = `Antenna ${antennaId}`;
    }

    return {
      antenna_id: antennaId || null,
      antenna_name: antennaName,
      zone_role: normalizeZoneRole(zoneRole),
    };
  }

  async function insertZoneEvent(client, input = {}) {
    const epc = normalizeIncomingTag(input.epc);
    const deviceId = String(input.device_id || "").trim();
    if (!epc || !deviceId) return null;

    const seenAt = parseScanTimestamp(input.ts).toISOString();
    const result = await client.query(
      `
      INSERT INTO zone_tag_events (
        epc,
        device_id,
        store_id,
        antenna_id,
        antenna_name,
        zone_role,
        ts,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
      RETURNING id, ts
      `,
      [
        epc,
        deviceId,
        normalizeStoreId(input.store_id),
        input.antenna_id || null,
        input.antenna_name || null,
        normalizeZoneRole(input.zone_role),
        seenAt,
        JSON.stringify(asObject(input.raw)),
      ]
    );

    return result.rows[0] || null;
  }

  async function upsertZoneSession(client, input = {}) {
    const epc = normalizeIncomingTag(input.epc);
    const deviceId = String(input.device_id || "").trim();
    const storeId = normalizeStoreId(input.store_id);
    const zoneRole = normalizeZoneRole(input.zone_role);
    const seenAtIso = parseScanTimestamp(input.seen_at).toISOString();

    if (!epc || !deviceId || zoneRole === "UNASSIGNED") {
      return { session: null, closed_sessions: [] };
    }

    const closed = await client.query(
      `
      UPDATE zone_tag_sessions
      SET
        status = 'CLOSED',
        exited_at = COALESCE(exited_at, $5::timestamptz),
        last_seen_at = GREATEST(last_seen_at, $5::timestamptz),
        metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
        updated_at = NOW()
      WHERE epc = $1
        AND (store_id IS NOT DISTINCT FROM $2::varchar)
        AND status = 'ACTIVE'
        AND (
          zone_role IS DISTINCT FROM $3
          OR device_id IS DISTINCT FROM $4
        )
      RETURNING id, epc, device_id, store_id, zone_role
      `,
      [
        epc,
        storeId,
        zoneRole,
        deviceId,
        seenAtIso,
        JSON.stringify({
          closed_reason: "zone_transition",
          closed_at: seenAtIso,
          next_zone_role: zoneRole,
          next_device_id: deviceId,
        }),
      ]
    );

    const existing = await client.query(
      `
      SELECT id
      FROM zone_tag_sessions
      WHERE epc = $1
        AND (store_id IS NOT DISTINCT FROM $2::varchar)
        AND zone_role = $3
        AND device_id = $4
        AND status = 'ACTIVE'
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [epc, storeId, zoneRole, deviceId]
    );

    if (existing.rowCount > 0) {
      const updated = await client.query(
        `
        UPDATE zone_tag_sessions
        SET
          last_seen_at = GREATEST(last_seen_at, $2::timestamptz),
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [
          existing.rows[0].id,
          seenAtIso,
          JSON.stringify({
            last_source: "scans/batch",
            last_zone_role: zoneRole,
            last_seen_at: seenAtIso,
          }),
        ]
      );

      return {
        session: updated.rows[0] || null,
        closed_sessions: closed.rows || [],
      };
    }

    const inserted = await client.query(
      `
      INSERT INTO zone_tag_sessions (
        epc,
        device_id,
        store_id,
        zone_role,
        entered_at,
        last_seen_at,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz, 'ACTIVE', $6::jsonb)
      RETURNING *
      `,
      [
        epc,
        deviceId,
        storeId,
        zoneRole,
        seenAtIso,
        JSON.stringify({
          entered_source: "scans/batch",
          last_source: "scans/batch",
          last_zone_role: zoneRole,
          last_seen_at: seenAtIso,
        }),
      ]
    );

    return {
      session: inserted.rows[0] || null,
      closed_sessions: closed.rows || [],
    };
  }

  async function getTagNetSales(client, storeId, tags = []) {
    const uniqueTags = Array.from(
      new Set(
        tags
          .map((tag) => normalizeIncomingTag(tag))
          .filter(Boolean)
      )
    );

    const out = new Map();
    for (const tag of uniqueTags) out.set(tag, 0);

    if (!storeId || !uniqueTags.length) {
      return out;
    }

    try {
      const result = await client.query(
        `
        SELECT
          t.epc,
          COALESCE(SUM(
            CASE
              WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                OR COALESCE(pt.total_items, 0) < 0
                OR COALESCE(pt.total_amount, 0) < 0
                THEN -1
              ELSE 1
            END
          ), 0)::int AS net_sold
        FROM UNNEST($2::varchar[]) AS t(epc)
        LEFT JOIN pos_transaction_items pti
          ON pti.epc = t.epc
        LEFT JOIN pos_transactions pt
          ON pt.id = pti.pos_txn_id
         AND (pt.store_id IS NOT DISTINCT FROM $1::varchar)
        GROUP BY t.epc
        `,
        [storeId, uniqueTags]
      );

      for (const row of result.rows) {
        out.set(String(row.epc), Number(row.net_sold || 0));
      }
      return out;
    } catch (err) {
      console.warn("[scans/runtime] pos net-sale query fallback:", err.message);
    }

    try {
      const fallback = await client.query(
        `
        SELECT
          t.epc,
          COALESCE(SUM(
            CASE
              WHEN te.event_type = 'POS_RETURN' THEN -1
              WHEN te.event_type = 'POS_SALE' THEN 1
              ELSE 0
            END
          ), 0)::int AS net_sold
        FROM UNNEST($2::varchar[]) AS t(epc)
        LEFT JOIN tag_events te
          ON te.epc = t.epc
         AND te.event_type IN ('POS_SALE', 'POS_RETURN')
         AND (te.source IS NULL OR te.source = $1::varchar)
        GROUP BY t.epc
        `,
        [storeId, uniqueTags]
      );

      for (const row of fallback.rows) {
        out.set(String(row.epc), Number(row.net_sold || 0));
      }
    } catch (err) {
      console.warn("[scans/runtime] tag_events fallback failed:", err.message);
    }

    return out;
  }

  function buildChangingDwellEntityId(epc, deviceId) {
    return `${String(epc || "").trim()}::${String(deviceId || "").trim()}`;
  }

  function compactAlertSnapshot(row) {
    if (!row || typeof row !== "object") return null;
    return {
      id: row.id || null,
      type: row.type || null,
      entity_type: row.entity_type || null,
      entity_id: row.entity_id || null,
      store_id: row.store_id || null,
      severity: Number(row.severity || 0),
      status: row.status || null,
    };
  }

  async function processSectionRuntime(client, input = {}) {
    const deviceId = String(input.device_id || "").trim();
    const fallbackStoreId = normalizeStoreId(input.store_id);
    const itemsByTag =
      input.items_by_tag instanceof Map ? input.items_by_tag : new Map();

    const summary = {
      device_id: deviceId || null,
      store_id: fallbackStoreId || null,
      zone_events_written: 0,
      sessions_touched: 0,
      alerts_opened: 0,
      alerts_updated: 0,
      alerts_resolved: 0,
      alerts: [],
    };

    if (!deviceId || !itemsByTag.size) {
      return summary;
    }

    await ensureDeviceZoneTables(client);
    const alertColumns = await getAlertColumns(client);
    const runtimeCfgCache = new Map();
    const runtimeCfg = await loadDeviceRuntimeConfig(
      client,
      deviceId,
      fallbackStoreId,
      runtimeCfgCache
    );

    if (!runtimeCfg) {
      return summary;
    }

    const storeId = normalizeStoreId(runtimeCfg.store_id || fallbackStoreId);
    summary.store_id = storeId;

    const alertIds = new Set();
    const exitCandidates = [];

    const collectAlert = (alertRow) => {
      const snapshot = compactAlertSnapshot(alertRow);
      if (!snapshot || !snapshot.id || alertIds.has(snapshot.id)) return;
      alertIds.add(snapshot.id);
      summary.alerts.push(snapshot);
    };

    const orderedTagEntries = Array.from(itemsByTag.entries()).sort(([a], [b]) =>
      String(a || "").localeCompare(String(b || ""))
    );

    for (const [tag, row] of orderedTagEntries) {
      const cleanTag = normalizeIncomingTag(tag);
      if (!cleanTag) continue;

      const scanTs = parseScanTimestamp(row?.ts);
      const zone = resolveZoneContext(row, runtimeCfg);

      await insertZoneEvent(client, {
        epc: cleanTag,
        device_id: deviceId,
        store_id: storeId,
        antenna_id: zone.antenna_id,
        antenna_name: zone.antenna_name,
        zone_role: zone.zone_role,
        ts: scanTs,
        raw: {
          ...asObject(row),
          runtime: {
            section_profile: runtimeCfg.section_profile,
            zone_role: zone.zone_role,
          },
        },
      });
      summary.zone_events_written += 1;

      if (zone.zone_role !== "UNASSIGNED") {
        const sessionResult = await upsertZoneSession(client, {
          epc: cleanTag,
          device_id: deviceId,
          store_id: storeId,
          zone_role: zone.zone_role,
          seen_at: scanTs,
        });

        if (sessionResult.session) {
          summary.sessions_touched += 1;
        }

        const closedSessions = Array.isArray(sessionResult.closed_sessions)
          ? sessionResult.closed_sessions
              .slice()
              .sort((a, b) =>
                buildChangingDwellEntityId(a?.epc, a?.device_id).localeCompare(
                  buildChangingDwellEntityId(b?.epc, b?.device_id)
                )
              )
          : [];

        for (const closed of closedSessions) {
          if (normalizeZoneRole(closed.zone_role) !== "CHANGING_ROOM") continue;

          const resolved = await resolveRuntimeAlert(client, alertColumns, {
            type: RUNTIME_ALERT_TYPES.CHANGING_ROOM_DWELL,
            store_id: storeId,
            entity_type: "TAG",
            entity_id: buildChangingDwellEntityId(closed.epc, closed.device_id),
            metadata: {
              resolved_reason: "zone_transition",
              resolved_zone_role: zone.zone_role,
              resolved_at: scanTs.toISOString(),
            },
          });

          if (resolved.action === "resolved") {
            summary.alerts_resolved += 1;
            collectAlert(resolved.alert);
          }
        }
      }

      if (
        storeId &&
        zone.zone_role === "EXIT" &&
        runtimeCfg.alert_rules?.exit_unpaid_enabled
      ) {
        exitCandidates.push({
          tag: cleanTag,
          scan_ts: scanTs.toISOString(),
          zone_role: zone.zone_role,
        });
      }
    }

    if (storeId && exitCandidates.length) {
      const netSoldMap = await getTagNetSales(
        client,
        storeId,
        exitCandidates.map((c) => c.tag)
      );

      const sortedExitCandidates = exitCandidates
        .slice()
        .sort((a, b) => String(a?.tag || "").localeCompare(String(b?.tag || "")));

      for (const candidate of sortedExitCandidates) {
        const netSold = Number(netSoldMap.get(candidate.tag) || 0);
        if (netSold > 0) {
          const resolved = await resolveRuntimeAlert(client, alertColumns, {
            type: RUNTIME_ALERT_TYPES.EXIT_UNPAID,
            store_id: storeId,
            entity_type: "TAG",
            entity_id: candidate.tag,
            metadata: {
              resolved_reason: "sold_state_detected",
              net_sold: netSold,
              resolved_at: candidate.scan_ts,
            },
          });
          if (resolved.action === "resolved") {
            summary.alerts_resolved += 1;
            collectAlert(resolved.alert);
          }
          continue;
        }

        const raised = await upsertRuntimeAlert(client, alertColumns, {
          type: RUNTIME_ALERT_TYPES.EXIT_UNPAID,
          store_id: storeId,
          entity_type: "TAG",
          entity_id: candidate.tag,
          severity: RUNTIME_ALERT_SEVERITY.EXIT_UNPAID,
          detected_at: candidate.scan_ts,
          metadata: {
            rule: "exit_unpaid_enabled",
            tag: candidate.tag,
            device_id: deviceId,
            section_profile: runtimeCfg.section_profile,
            zone_role: candidate.zone_role,
            last_scan_ts: candidate.scan_ts,
            net_sold: netSold,
          },
        });

        if (raised.action === "inserted") summary.alerts_opened += 1;
        if (raised.action === "updated") summary.alerts_updated += 1;
        collectAlert(raised.alert);
      }
    }

    if (storeId) {
      const sweepKey = String(storeId || "_NO_STORE_");
      const nowMs = Date.now();
      const lastSweepAt = Number(changingRoomSweepAtByStore.get(sweepKey) || 0);
      if (lastSweepAt > 0 && nowMs - lastSweepAt < CHANGING_ROOM_SWEEP_WINDOW_MS) {
        return summary;
      }
      changingRoomSweepAtByStore.set(sweepKey, nowMs);

      const changingSessions = await client.query(
        `
        SELECT id, epc, device_id, entered_at, last_seen_at
        FROM zone_tag_sessions
        WHERE (store_id IS NOT DISTINCT FROM $1::varchar)
          AND zone_role = 'CHANGING_ROOM'
          AND status = 'ACTIVE'
        ORDER BY epc ASC, device_id ASC, entered_at ASC, id ASC
        `,
        [storeId]
      );

      for (const session of changingSessions.rows) {
        const sessionDeviceId = String(session.device_id || "").trim();
        const sessionTag = normalizeIncomingTag(session.epc);
        if (!sessionDeviceId || !sessionTag) continue;

        const cfg = await loadDeviceRuntimeConfig(
          client,
          sessionDeviceId,
          storeId,
          runtimeCfgCache
        );
        if (!cfg?.alert_rules?.changing_room_dwell_enabled) continue;

        const dwellThresholdMinutes = Math.min(
          Math.max(Number(cfg.alert_rules.changing_room_dwell_minutes) || 40, 5),
          240
        );
        const enteredMs = new Date(session.entered_at).getTime();
        if (!Number.isFinite(enteredMs)) continue;

        const dwellMinutes = Math.floor((nowMs - enteredMs) / 60000);
        if (dwellMinutes < dwellThresholdMinutes) continue;

        const raised = await upsertRuntimeAlert(client, alertColumns, {
          type: RUNTIME_ALERT_TYPES.CHANGING_ROOM_DWELL,
          store_id: storeId,
          entity_type: "TAG",
          entity_id: buildChangingDwellEntityId(sessionTag, sessionDeviceId),
          severity: RUNTIME_ALERT_SEVERITY.CHANGING_ROOM_DWELL,
          detected_at: new Date().toISOString(),
          metadata: {
            rule: "changing_room_dwell_enabled",
            tag: sessionTag,
            device_id: sessionDeviceId,
            section_profile: cfg.section_profile,
            zone_role: "CHANGING_ROOM",
            entered_at: session.entered_at,
            last_seen_at: session.last_seen_at,
            dwell_minutes: dwellMinutes,
            dwell_threshold_minutes: dwellThresholdMinutes,
          },
        });

        if (raised.action === "inserted") summary.alerts_opened += 1;
        if (raised.action === "updated") summary.alerts_updated += 1;
        collectAlert(raised.alert);
      }
    }

    return summary;
  }

  /* =========================
     GET /api/v1/scans
  ========================= */
  router.get("/", authenticate, async (req, res) => {
    try {
      let includeCatalog = true;
      try {
        await ensureCatalogTable(pool);
      } catch (err) {
        includeCatalog = false;
        console.warn("[scans] catalog unavailable, returning raw scans only");
      }

      const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
      const storeId = req.query.store_id ? String(req.query.store_id) : null;
      const scopedStoreIds =
        !storeId && !isAdminUser(req)
          ? Array.from(
              new Set(
                (Array.isArray(req.user?.store_ids) ? req.user.store_ids : [])
                  .map((id) => String(id || "").trim())
                  .filter(Boolean)
              )
            )
          : null;

      if (storeId && !canAccessStore(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      if (!storeId && !isAdminUser(req) && !scopedStoreIds?.length) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const result = includeCatalog
        ? storeId
          ? await pool.query(
              `
              SELECT
                s.id,
                s.batch_id,
                s.device_id,
                s.tag,
                s.ts,
                s.read_count,
                s.first_seen,
                s.last_seen,
                s.processing_status,
                s.metrics_summary,
                s.store_id,
                s.rssi,
                s.created_at,
                s.updated_at,
                c.sku,
                c.product_name,
                c.brand,
                c.category,
                c.size_label,
                c.color,
                c.price_lkr
              FROM scan_items s
              LEFT JOIN catalog_items c
                ON c.store_id = s.store_id
               AND c.epc = s.tag
              WHERE s.store_id = $1
              ORDER BY COALESCE(s.last_seen, s.ts) DESC
              LIMIT $2
              `,
              [storeId, limit]
            )
          : scopedStoreIds
            ? await pool.query(
                `
                SELECT
                  s.id,
                  s.batch_id,
                  s.device_id,
                  s.tag,
                  s.ts,
                  s.read_count,
                  s.first_seen,
                  s.last_seen,
                  s.processing_status,
                  s.metrics_summary,
                  s.store_id,
                  s.rssi,
                  s.created_at,
                  s.updated_at,
                  c.sku,
                  c.product_name,
                  c.brand,
                  c.category,
                  c.size_label,
                  c.color,
                  c.price_lkr
                FROM scan_items s
                LEFT JOIN catalog_items c
                  ON c.store_id = s.store_id
                 AND c.epc = s.tag
                WHERE s.store_id = ANY($1::varchar[])
                ORDER BY COALESCE(s.last_seen, s.ts) DESC
                LIMIT $2
                `,
                [scopedStoreIds, limit]
              )
          : await pool.query(
              `
              SELECT
                s.id,
                s.batch_id,
                s.device_id,
                s.tag,
                s.ts,
                s.read_count,
                s.first_seen,
                s.last_seen,
                s.processing_status,
                s.metrics_summary,
                s.store_id,
                s.rssi,
                s.created_at,
                s.updated_at,
                c.sku,
                c.product_name,
                c.brand,
                c.category,
                c.size_label,
                c.color,
                c.price_lkr
              FROM scan_items s
              LEFT JOIN catalog_items c
                ON c.store_id = s.store_id
               AND c.epc = s.tag
              ORDER BY COALESCE(s.last_seen, s.ts) DESC
              LIMIT $1
              `,
              [limit]
            )
        : storeId
          ? await pool.query(
              `
              SELECT
                id, batch_id, device_id, tag, ts, read_count, first_seen, last_seen,
                processing_status, metrics_summary, store_id, rssi,
                created_at, updated_at
              FROM scan_items
              WHERE store_id = $1
              ORDER BY COALESCE(last_seen, ts) DESC
              LIMIT $2
              `,
              [storeId, limit]
            )
          : scopedStoreIds
            ? await pool.query(
                `
                SELECT
                  id, batch_id, device_id, tag, ts, read_count, first_seen, last_seen,
                  processing_status, metrics_summary, store_id, rssi,
                  created_at, updated_at
                FROM scan_items
                WHERE store_id = ANY($1::varchar[])
                ORDER BY COALESCE(last_seen, ts) DESC
                LIMIT $2
                `,
                [scopedStoreIds, limit]
              )
          : await pool.query(
              `
              SELECT
                id, batch_id, device_id, tag, ts, read_count, first_seen, last_seen,
                processing_status, metrics_summary, store_id, rssi,
                created_at, updated_at
              FROM scan_items
              ORDER BY COALESCE(last_seen, ts) DESC
              LIMIT $1
              `,
              [limit]
            );

      res.json({
        ok: true,
        count: result.rowCount,
        scans: result.rows,
      });
    } catch (err) {
      console.error("[scans] GET error:", err);
      res.status(500).json({ ok: false, error: "Failed to fetch scans" });
    }
  });

  /* =========================
     TAG REGISTRY DECISION API
  ========================= */

  router.post("/tag-registry/check", authenticate, async (req, res) => {
    try {
      const epc = normalizeTagValue(req.body?.epc);
      const tid = normalizeTagValue(req.body?.tid);
      const storeId = String(req.body?.store_id || "").trim();

      if (!epc) {
        return res.status(400).json({ ok: false, error: "epc required" });
      }

      if (!storeId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canUseTagIntake(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureTagRegistryTable(pool);

      const companyName = resolveCompanyScope(req);
      const epcRows = await loadTagRowsByEpc(pool, {
        epc,
        storeId,
        companyName,
      });
      const tagState = classifyTagState(epcRows, tid);
      const includeInternalUid = canExposeInternalUid(
        req.user,
        req.body?.include_internal_uid
      );

      return res.json(
        toTagCheckResponse({
          epc,
          tid,
          storeId,
          tagState,
          includeInternalUid,
        })
      );
    } catch (err) {
      console.error("[scans/tag-registry/check]", err);
      return res.status(500).json({ ok: false, error: "Failed to check tag" });
    }
  });

  router.post("/tag-registry/confirm", authenticate, async (req, res) => {
    try {
      const epc = normalizeTagValue(req.body?.epc);
      const tid = normalizeTagValue(req.body?.tid);
      const storeId = String(req.body?.store_id || "").trim();
      let decision = normalizeDecision(req.body?.decision);

      if (!epc) {
        return res.status(400).json({ ok: false, error: "epc required" });
      }

      if (!storeId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canUseTagIntake(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureTagRegistryTable(pool);

      const companyName = resolveCompanyScope(req);
      const epcRows = await loadTagRowsByEpc(pool, {
        epc,
        storeId,
        companyName,
      });
      const tagState = classifyTagState(epcRows, tid);
      const includeInternalUid = canExposeInternalUid(
        req.user,
        req.body?.include_internal_uid
      );

      if (!decision) {
        if (tagState.status === "NEW_TAG") {
          decision = "insert_as_new_tag";
        } else {
          const checkResponse = toTagCheckResponse({
            epc,
            tid,
            storeId,
            tagState,
            includeInternalUid,
          });

          return res.status(409).json({
            ...checkResponse,
            ok: false,
            error: "duplicate_action_required",
          });
        }
      }

      if (!tagState.allowed_actions.includes(decision)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_decision",
          allowed_actions: tagState.allowed_actions,
        });
      }

      if (decision === "already_available") {
        const target = tagState.exact || tagState.latest;
        if (!target) {
          return res.status(404).json({
            ok: false,
            error: "tag_not_found_for_action",
          });
        }

        const touched = await touchTagRegistryRow(pool, target.id);
        const resolved = touched || target;

        await writeAuditLog(pool, {
          actor_user_id: req.user?.user_id || null,
          actor_email: req.user?.email || null,
          action: "tag_registry.already_available",
          entity_type: "tag_registry",
          entity_id: String(resolved.id || target.id),
          store_id: storeId,
          metadata: {
            epc,
            tid,
            decision,
            status: tagState.status,
            existing_count_by_epc: tagState.total_epc_rows,
          },
        });

        return res.json({
          ok: true,
          created: false,
          outcome: "already_available",
          status: tagState.status,
          tag: sanitizeTagRegistryRow(resolved, { includeInternalUid }),
        });
      }

      const incomingMetadata =
        req.body?.metadata &&
        typeof req.body.metadata === "object" &&
        !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {};

      const inserted = await insertTagRegistryRow(pool, {
        epc,
        tid,
        store_id: storeId,
        company_name: companyName,
        source: tagState.status === "NEW_TAG" ? "NEW_SCAN" : "DUPLICATE_OVERRIDE",
        duplicate_of_internal_uid:
          tagState.status === "NEW_TAG" ? null : tagState.latest?.internal_uid || null,
        created_by_user_id: req.user?.user_id || null,
        created_by_email: req.user?.email || null,
        metadata: {
          ...incomingMetadata,
          inserted_from_status: tagState.status,
          decision,
        },
      });

      await writeAuditLog(pool, {
        actor_user_id: req.user?.user_id || null,
        actor_email: req.user?.email || null,
        action: "tag_registry.insert_as_new",
        entity_type: "tag_registry",
        entity_id: String(inserted.id),
        store_id: storeId,
        metadata: {
          epc,
          tid,
          decision,
          status: tagState.status,
          duplicate_of_internal_uid: tagState.latest?.internal_uid || null,
        },
      });

      return res.json({
        ok: true,
        created: true,
        outcome: "inserted_new_tag",
        status_before_insert: tagState.status,
        tag: sanitizeTagRegistryRow(inserted, { includeInternalUid }),
      });
    } catch (err) {
      console.error("[scans/tag-registry/confirm]", err);
      return res.status(500).json({ ok: false, error: "Failed to confirm tag action" });
    }
  });

  router.get("/tag-registry", authenticate, async (req, res) => {
    try {
      if (!isAdminUser(req)) {
        return res.status(403).json({ ok: false, error: "Admin required" });
      }

      await ensureTagRegistryTable(pool);

      const storeId = req.query.store_id ? String(req.query.store_id).trim() : "";
      const requestedCompany = req.query.company_name
        ? String(req.query.company_name).trim()
        : "";
      const q = req.query.q ? String(req.query.q).trim().toUpperCase() : "";
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const includeInternalUid = canExposeInternalUid(
        req.user,
        req.query.include_internal_uid
      );

      if (storeId && !canAccessStore(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const where = [];
      const values = [];
      let i = 1;

      if (storeId) {
        where.push(`store_id = $${i++}`);
        values.push(storeId);
      }

      if (q) {
        where.push(`(epc ILIKE $${i} OR COALESCE(tid, '') ILIKE $${i})`);
        values.push(`%${q}%`);
        i += 1;
      }

      if (hasMasterRole(req.user)) {
        if (requestedCompany) {
          where.push(`company_name = $${i}`);
          values.push(requestedCompany);
          i += 1;
        }
      }

      if (!hasMasterRole(req.user)) {
        const companyName = resolveCompanyScope(req);
        if (!companyName) {
          return res.status(400).json({
            ok: false,
            error: "company scope missing for admin account",
          });
        }
        where.push(`(company_name = $${i} OR company_name IS NULL)`);
        values.push(companyName);
        i += 1;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const result = await pool.query(
        `
        SELECT
          id,
          internal_uid,
          epc,
          tid,
          store_id,
          company_name,
          source,
          duplicate_of_internal_uid,
          created_by_user_id,
          created_by_email,
          metadata,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        FROM tag_registry
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${i}
        OFFSET $${i + 1}
        `,
        [...values, limit, offset]
      );

      if (includeInternalUid) {
        await writeAuditLog(pool, {
          actor_user_id: req.user?.user_id || null,
          actor_email: req.user?.email || null,
          action: "tag_registry.view_internal_uid",
          entity_type: "tag_registry",
          entity_id: storeId || "_GLOBAL_",
          store_id: storeId || null,
          metadata: {
            q: q || null,
            limit,
            offset,
            rows: result.rowCount || 0,
          },
        });
      }

      return res.json({
        ok: true,
        count: result.rowCount,
        company_name: hasMasterRole(req.user) ? requestedCompany || null : resolveCompanyScope(req),
        tags: result.rows.map((row) =>
          sanitizeTagRegistryRow(row, { includeInternalUid })
        ),
        internal_uid_visible: includeInternalUid,
      });
    } catch (err) {
      console.error("[scans/tag-registry/list]", err);
      return res.status(500).json({ ok: false, error: "Failed to load tag registry" });
    }
  });

  router.post("/tag-registry/backfill", authenticate, async (req, res) => {
    try {
      if (!hasMasterRole(req.user)) {
        return res.status(403).json({
          ok: false,
          error: "MASTER_ADMIN required",
        });
      }

      await ensureTagRegistryTable(pool);

      const storeIdRaw = req.body?.store_id ? String(req.body.store_id).trim() : "";
      const companyName = String(req.body?.company_name || "").trim();
      const limit = Math.min(Math.max(Number(req.body?.limit) || 3000, 1), 10000);

      if (!companyName) {
        return res.status(400).json({
          ok: false,
          error: "company_name required",
        });
      }

      const where = [];
      const values = [];
      let i = 1;

      if (storeIdRaw) {
        where.push(`store_id = $${i++}`);
        values.push(storeIdRaw);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const scansResult = await pool.query(
        `
        SELECT
          tag AS epc,
          store_id,
          MAX(ts) AS last_scan_ts
        FROM scan_items
        ${whereSql}
        GROUP BY tag, store_id
        ORDER BY MAX(ts) DESC
        LIMIT $${i}
        `,
        [...values, limit]
      );

      const candidates = scansResult.rows || [];
      if (!candidates.length) {
        return res.json({
          ok: true,
          inserted: 0,
          skipped_existing: 0,
          scanned_candidates: 0,
          company_name: companyName,
          store_id: storeIdRaw || null,
        });
      }

      const epcList = Array.from(
        new Set(
          candidates
            .map((row) => normalizeTagValue(row?.epc))
            .filter(Boolean)
        )
      );

      const existingRes = await pool.query(
        `
        SELECT epc, store_id, company_name
        FROM tag_registry
        WHERE epc = ANY($1::varchar[])
        `,
        [epcList]
      );

      const existingKeys = new Set(
        existingRes.rows.map((row) =>
          [
            normalizeTagValue(row.epc) || "",
            String(row.store_id || ""),
            String(row.company_name || ""),
          ].join("::")
        )
      );

      let inserted = 0;
      let skipped = 0;

      for (const row of candidates) {
        const epc = normalizeTagValue(row?.epc);
        const scanStoreId = String(row?.store_id || "").trim() || null;
        if (!epc) {
          skipped += 1;
          continue;
        }

        const key = [epc, String(scanStoreId || ""), companyName].join("::");
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }

        await insertTagRegistryRow(pool, {
          epc,
          tid: null,
          store_id: scanStoreId,
          company_name: companyName,
          source: "SCAN_BACKFILL",
          created_by_user_id: req.user?.user_id || null,
          created_by_email: req.user?.email || null,
          metadata: {
            backfilled: true,
            from_table: "scan_items",
            last_scan_ts: row.last_scan_ts || null,
          },
        });

        existingKeys.add(key);
        inserted += 1;
      }

      await writeAuditLog(pool, {
        actor_user_id: req.user?.user_id || null,
        actor_email: req.user?.email || null,
        action: "tag_registry.backfill_from_scans",
        entity_type: "tag_registry",
        entity_id: storeIdRaw || "_ALL_STORES_",
        store_id: storeIdRaw || null,
        metadata: {
          company_name: companyName,
          inserted,
          skipped_existing: skipped,
          scanned_candidates: candidates.length,
          limit,
        },
      });

      return res.json({
        ok: true,
        inserted,
        skipped_existing: skipped,
        scanned_candidates: candidates.length,
        company_name: companyName,
        store_id: storeIdRaw || null,
      });
    } catch (err) {
      console.error("[scans/tag-registry/backfill]", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to backfill tag registry",
      });
    }
  });

  /* =========================
     POST /api/v1/scans/batch
     (JWT OR Scan Key)
  ========================= */
  router.post(
    "/batch",
    allowJwtOrScanKey,
    async (req, res) => {
      try {
        let catalogAvailable = false;
        try {
          await ensureCatalogTable(pool);
          catalogAvailable = true;
        } catch {
          catalogAvailable = false;
        }

        const { device_id, store_id, items = [] } = req.body;

        if (!device_id || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({
            ok: false,
            error: "Invalid body",
          });
        }

        const aggregatedBatch = aggregateScanItems(items);
        const incomingTags = Array.from(aggregatedBatch.itemsByTag.keys());
        if (!incomingTags.length) {
          return res.status(400).json({
            ok: false,
            error: "Invalid body (no valid tags)",
          });
        }

        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          const activeInventorySession = store_id
            ? await getActiveInventorySession(client, store_id)
            : null;
          const activeBillingSession = store_id
            ? await getActiveBillingSession(client, store_id)
            : null;
          const shouldAutoCreateCatalog =
            catalogAvailable &&
            AUTO_CREATE_CATALOG_FROM_SCANS &&
            store_id &&
            !activeBillingSession;

          if (shouldAutoCreateCatalog) {
            for (const tag of incomingTags) {
              const item = buildAutoCatalog(tag, store_id);
              await client.query(
                `
                INSERT INTO catalog_items (
                  store_id,
                  epc,
                  sku,
                  product_name,
                  brand,
                  category,
                  size_label,
                  color,
                  price_lkr,
                  metadata,
                  updated_at
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::jsonb, NOW()
                )
                ON CONFLICT (store_id, epc)
                DO NOTHING
                `,
                [
                  item.store_id,
                  item.epc,
                  item.sku,
                  item.product_name,
                  item.brand,
                  item.category,
                  item.size_label,
                  item.color,
                  item.price_lkr,
                  JSON.stringify({ auto_mapped: true }),
                ]
              );
            }
          }

          // Create batch
          const batchRes = await client.query(
            `
            INSERT INTO scan_batches (
              device_id,
              store_id,
              received_count,
              unique_epc_count,
              metrics_summary
            )
            VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING *
            `,
            [
              device_id,
              store_id,
              aggregatedBatch.received_count,
              aggregatedBatch.unique_epc_count,
              JSON.stringify({
                status: "INGESTING",
                duration_ms: aggregatedBatch.duration_ms,
              }),
            ]
          );

          let batch = batchRes.rows[0];
          const storeScope = normalizeStoreScope(store_id);

          // Heartbeat / upsert device as online from scan activity
          await client.query(
            `
            INSERT INTO devices (
              device_id,
              name,
              store_id,
              status,
              last_seen,
              last_heartbeat,
              metadata
            )
            VALUES ($1::varchar, $2::varchar, $3::varchar, 'online', NOW(), NOW(), '{}'::jsonb)
            ON CONFLICT (device_id)
            DO UPDATE SET
              name = COALESCE(EXCLUDED.name, devices.name),
              store_id = EXCLUDED.store_id,
              status = 'online',
              last_seen = NOW(),
              last_heartbeat = NOW(),
              updated_at = NOW()
            `,
            [device_id, device_id, store_id]
          );

          const insertedTags = [];
          const decisions = [];
          const confirmedObservations = [];
          const runtimeItemsByTag = new Map();
          const orderedObservations = Array.from(aggregatedBatch.itemsByTag.entries()).sort(
            ([a], [b]) => String(a || "").localeCompare(String(b || ""))
          );

          for (const [tag, observation] of orderedObservations) {
            const stateResult = await client.query(
              `
              SELECT *
              FROM scan_epc_state
              WHERE device_id = $1
                AND store_id = $2
                AND epc = $3
              LIMIT 1
              FOR UPDATE
              `,
              [device_id, storeScope, tag]
            );

            const previousState = stateResult.rows[0] || null;
            const decision = decideScanDisposition({
              previous: previousState,
              observation,
              now: observation.last_seen_at,
              stabilityThreshold: SCAN_STABILITY_THRESHOLD,
              duplicateWindowMs: SCAN_DUPLICATE_WINDOW_MS,
              minRssi: SCAN_MIN_RSSI,
            });

            const strongestIncomingRssi = Number(observation.strongest_rssi);
            const strongestPreviousRssi = Number(previousState?.strongest_rssi);
            const nextStrongestRssi =
              Number.isFinite(strongestIncomingRssi) && Number.isFinite(strongestPreviousRssi)
                ? Math.max(strongestPreviousRssi, strongestIncomingRssi)
                : Number.isFinite(strongestIncomingRssi)
                ? strongestIncomingRssi
                : Number.isFinite(strongestPreviousRssi)
                ? strongestPreviousRssi
                : null;
            const nextAverageRssi = mergeAverageRssi(previousState, observation);
            const stateMetadata = {
              batch_id: batch.id,
              device_id,
              store_id: store_id || null,
              last_status: decision.status,
              stability_threshold: SCAN_STABILITY_THRESHOLD,
              duplicate_window_ms: SCAN_DUPLICATE_WINDOW_MS,
              min_rssi: SCAN_MIN_RSSI,
            };

            if (previousState) {
              await client.query(
                `
                UPDATE scan_epc_state
                SET
                  first_seen_at = LEAST(first_seen_at, $2::timestamptz),
                  last_seen_at = GREATEST(last_seen_at, $3::timestamptz),
                  read_count = $4,
                  confirmed_count = $5,
                  strongest_rssi = $6,
                  average_rssi = $7,
                  last_confirmed_at = $8::timestamptz,
                  last_status = $9,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
                  updated_at = NOW()
                WHERE id = $1
                `,
                [
                  previousState.id,
                  observation.first_seen_at.toISOString(),
                  observation.last_seen_at.toISOString(),
                  decision.total_reads,
                  Number(previousState.confirmed_count || 0) + (decision.confirmed ? 1 : 0),
                  nextStrongestRssi,
                  nextAverageRssi,
                  decision.confirmed
                    ? observation.last_seen_at.toISOString()
                    : previousState.last_confirmed_at || null,
                  decision.status,
                  JSON.stringify(stateMetadata),
                ]
              );
            } else {
              await client.query(
                `
                INSERT INTO scan_epc_state (
                  device_id,
                  store_id,
                  epc,
                  first_seen_at,
                  last_seen_at,
                  read_count,
                  confirmed_count,
                  strongest_rssi,
                  average_rssi,
                  last_confirmed_at,
                  last_status,
                  metadata
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  $4::timestamptz,
                  $5::timestamptz,
                  $6,
                  $7,
                  $8,
                  $9,
                  $10::timestamptz,
                  $11,
                  $12::jsonb
                )
                `,
                [
                  device_id,
                  storeScope,
                  tag,
                  observation.first_seen_at.toISOString(),
                  observation.last_seen_at.toISOString(),
                  decision.total_reads,
                  decision.confirmed ? 1 : 0,
                  nextStrongestRssi,
                  nextAverageRssi,
                  decision.confirmed ? observation.last_seen_at.toISOString() : null,
                  decision.status,
                  JSON.stringify(stateMetadata),
                ]
              );
            }

            decisions.push({ tag, observation, previousState, decision });

            if (!decision.confirmed) {
              continue;
            }

            confirmedObservations.push({ tag, observation, decision });
            runtimeItemsByTag.set(tag, {
              ...(observation.sample || {}),
              tag,
              ts: observation.last_seen_at.toISOString(),
              first_seen: observation.first_seen_at.toISOString(),
              last_seen: observation.last_seen_at.toISOString(),
              read_count: Number(observation.observation_count || 1),
              strongest_rssi: observation.strongest_rssi ?? null,
              average_rssi: observation.average_rssi ?? null,
            });

            await client.query(
              `
              INSERT INTO scan_items (
                batch_id,
                device_id,
                tag,
                ts,
                store_id,
                raw,
                rssi,
                read_count,
                first_seen,
                last_seen,
                processing_status,
                metrics_summary
              )
              VALUES (
                $1,
                $2::varchar,
                $3::varchar,
                $4::timestamptz,
                $5::varchar,
                $6::jsonb,
                $7,
                $8,
                $9::timestamptz,
                $10::timestamptz,
                $11,
                $12::jsonb
              )
              ON CONFLICT (device_id, tag, ts)
              DO UPDATE SET
                batch_id = COALESCE(EXCLUDED.batch_id, scan_items.batch_id),
                store_id = COALESCE(EXCLUDED.store_id, scan_items.store_id),
                raw = EXCLUDED.raw,
                rssi = COALESCE(EXCLUDED.rssi, scan_items.rssi),
                read_count = GREATEST(scan_items.read_count, EXCLUDED.read_count),
                first_seen = LEAST(
                  COALESCE(scan_items.first_seen, EXCLUDED.first_seen),
                  EXCLUDED.first_seen
                ),
                last_seen = GREATEST(
                  COALESCE(scan_items.last_seen, EXCLUDED.last_seen),
                  EXCLUDED.last_seen
                ),
                processing_status = EXCLUDED.processing_status,
                metrics_summary = COALESCE(scan_items.metrics_summary, '{}'::jsonb) || EXCLUDED.metrics_summary,
                updated_at = NOW()
              `,
              [
                batch.id,
                device_id,
                tag,
                observation.last_seen_at.toISOString(),
                store_id,
                JSON.stringify(observation.sample || { tag }),
                Number.isFinite(Number(observation.strongest_rssi))
                  ? Number(observation.strongest_rssi)
                  : null,
                Number(observation.observation_count || 1),
                observation.first_seen_at.toISOString(),
                observation.last_seen_at.toISOString(),
                decision.status,
                JSON.stringify({
                  batch_id: batch.id,
                  observation_count: Number(observation.observation_count || 1),
                  total_reads: Number(decision.total_reads || observation.observation_count || 1),
                  strongest_rssi: observation.strongest_rssi ?? null,
                  average_rssi: observation.average_rssi ?? null,
                }),
              ]
            );

            insertedTags.push(tag);
          }

          const metrics = batchMetrics({
            decisions,
            received_count: aggregatedBatch.received_count,
            unique_epc_count: aggregatedBatch.unique_epc_count,
            duration_ms: aggregatedBatch.duration_ms,
          });

          /* =========================
             AUTO LINK → INVENTORY
          ========================= */
          if (store_id) {
            if (activeInventorySession) {
              for (const { tag, observation } of confirmedObservations) {
                await client.query(
                  `
                  INSERT INTO inventory_scans (
                    session_id,
                    epc,
                    read_count,
                    device_id,
                    last_seen,
                    store_id,
                    metadata
                  )
                  VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::jsonb)
                  ON CONFLICT (session_id, epc)
                  DO UPDATE SET
                    read_count = inventory_scans.read_count + EXCLUDED.read_count,
                    device_id = COALESCE(EXCLUDED.device_id, inventory_scans.device_id),
                    last_seen = GREATEST(inventory_scans.last_seen, EXCLUDED.last_seen),
                    store_id = COALESCE(EXCLUDED.store_id, inventory_scans.store_id),
                    metadata = COALESCE(inventory_scans.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = NOW()
                  `,
                  [
                    activeInventorySession.id,
                    tag,
                    Number(observation.observation_count || 1),
                    device_id,
                    observation.last_seen_at.toISOString(),
                    store_id,
                    JSON.stringify({
                      batch_id: batch.id,
                      source_status: "CONFIRMED",
                      first_seen: observation.first_seen_at.toISOString(),
                    }),
                  ]
                );
              }

              await client.query(
                `
                UPDATE inventory_sessions
                SET
                  total_found = (
                    SELECT COUNT(*)
                    FROM inventory_scans
                    WHERE session_id = $1
                  ),
                  metrics_summary = COALESCE(metrics_summary, '{}'::jsonb) || $2::jsonb,
                  updated_at = NOW()
                WHERE id = $1
                `,
                [
                  activeInventorySession.id,
                  JSON.stringify({
                    last_batch_id: batch.id,
                    last_device_id: device_id,
                    total_reads: metrics.total_reads,
                    read_rate: metrics.read_rate,
                  }),
                ]
              );
            }

            if (activeBillingSession) {
              for (const { tag, observation } of confirmedObservations) {
                const existingBilling = await client.query(
                  `
                  SELECT read_count
                  FROM billing_session_scans
                  WHERE session_id = $1
                    AND epc = $2
                  LIMIT 1
                  `,
                  [activeBillingSession.id, tag]
                );
                const duplicateReadCount = Number(existingBilling.rows[0]?.read_count || 0);
                const validation = await validateRetailScan(client, {
                  store_id,
                  epc: tag,
                  duplicate_read_count: duplicateReadCount,
                });

                await client.query(
                  `
                  INSERT INTO billing_session_scans (
                    session_id,
                    epc,
                    device_id,
                    read_count,
                    first_seen,
                    last_seen,
                    validation_status,
                    validation_message,
                    sku,
                    product_name,
                    price_lkr,
                    metadata,
                    last_validation_at
                  )
                  VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5::timestamptz,
                    $6::timestamptz,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12::jsonb,
                    NOW()
                  )
                  ON CONFLICT (session_id, epc)
                  DO UPDATE SET
                    read_count = billing_session_scans.read_count + EXCLUDED.read_count,
                    device_id = COALESCE(EXCLUDED.device_id, billing_session_scans.device_id),
                    last_seen = GREATEST(billing_session_scans.last_seen, EXCLUDED.last_seen),
                    validation_status = EXCLUDED.validation_status,
                    validation_message = EXCLUDED.validation_message,
                    sku = COALESCE(EXCLUDED.sku, billing_session_scans.sku),
                    product_name = COALESCE(EXCLUDED.product_name, billing_session_scans.product_name),
                    price_lkr = COALESCE(EXCLUDED.price_lkr, billing_session_scans.price_lkr),
                    metadata = COALESCE(billing_session_scans.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    last_validation_at = NOW(),
                    updated_at = NOW()
                  `,
                  [
                    activeBillingSession.id,
                    tag,
                    device_id,
                    Number(observation.observation_count || 1),
                    observation.first_seen_at.toISOString(),
                    observation.last_seen_at.toISOString(),
                    validation.validation_status,
                    validation.validation_message,
                    validation.catalog_item?.sku || null,
                    validation.catalog_item?.product_name || null,
                    validation.catalog_item?.price_lkr || null,
                    JSON.stringify({
                      validation_label: validation.validation_label,
                      already_billed: validation.already_billed,
                      batch_id: batch.id,
                      source_status: "CONFIRMED",
                    }),
                  ]
                );

                await trackBillingValidationAlert(client, store_id, validation, {
                  epc: tag,
                  device_id,
                  session_id:
                    String(activeBillingSession.session_id || "").trim() ||
                    `BILL-${activeBillingSession.id}`,
                });
              }

              await client.query(
                `
                UPDATE billing_sessions
                SET
                  scanned_items_count = (
                    SELECT COUNT(*)
                    FROM billing_session_scans
                    WHERE session_id = $1
                  ),
                  metrics_summary = COALESCE(metrics_summary, '{}'::jsonb) || $2::jsonb,
                  updated_at = NOW()
                WHERE id = $1
                `,
                [
                  activeBillingSession.id,
                  JSON.stringify({
                    last_batch_id: batch.id,
                    last_device_id: device_id,
                    total_reads: metrics.total_reads,
                    read_rate: metrics.read_rate,
                  }),
                ]
              );
            }
          }

          const updatedBatch = await client.query(
            `
            UPDATE scan_batches
            SET
              received_count = $2,
              unique_epc_count = $3,
              confirmed_count = $4,
              duplicate_count = $5,
              noisy_count = $6,
              pending_count = $7,
              metrics_summary = $8::jsonb,
              metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb
            WHERE id = $1
            RETURNING *
            `,
            [
              batch.id,
              metrics.received_count,
              metrics.unique_epc_count,
              metrics.confirmed_count,
              metrics.duplicate_count,
              metrics.noisy_count,
              metrics.pending_count,
              JSON.stringify({
                ...metrics,
                stability_threshold: SCAN_STABILITY_THRESHOLD,
                duplicate_window_ms: SCAN_DUPLICATE_WINDOW_MS,
                min_rssi: SCAN_MIN_RSSI,
              }),
              JSON.stringify({
                confirmed_tags: confirmedObservations.map((entry) => entry.tag),
                active_inventory_session_id: activeInventorySession?.id || null,
                active_billing_session_id: activeBillingSession?.id || null,
              }),
            ]
          );

          batch = updatedBatch.rows[0] || batch;

          let runtimeSummary = {
            device_id,
            store_id: normalizeStoreId(store_id),
            zone_events_written: 0,
            sessions_touched: 0,
            alerts_opened: 0,
            alerts_updated: 0,
            alerts_resolved: 0,
            alerts: [],
          };

          await client.query(
            `SET LOCAL lock_timeout = '${Math.round(RUNTIME_DB_LOCK_TIMEOUT_MS)}ms'`
          );
          await client.query("SAVEPOINT scans_runtime");
          try {
            runtimeSummary = await processSectionRuntime(client, {
              device_id,
              store_id,
              items_by_tag: runtimeItemsByTag,
            });
            await client.query("RELEASE SAVEPOINT scans_runtime");
          } catch (runtimeErr) {
            await client.query("ROLLBACK TO SAVEPOINT scans_runtime");
            await client.query("RELEASE SAVEPOINT scans_runtime");
            runtimeSummary.error =
              runtimeErr?.message || "runtime_section_logic_failed";
            console.error("[scans/batch][runtime]", runtimeErr);
          }

          await client.query("COMMIT");

          // SSE broadcast
          const broadcast = req.app.locals.broadcastEvent;
          if (typeof broadcast === "function") {
            for (const { tag, observation } of confirmedObservations) {
              broadcast("scan", {
                tag,
                device_id,
                store_id,
                read_count: Number(observation.observation_count || 1),
                processing_status: "CONFIRMED",
                batch_id: batch.id,
              });
            }

            broadcast("scan_metrics", {
              source: "scans/batch",
              store_id,
              device_id,
              batch_id: batch.id,
              metrics,
            });

            if (runtimeSummary.zone_events_written > 0) {
              broadcast("devices_changed", {
                source: "scans/batch",
                store_id: runtimeSummary.store_id || store_id || null,
                device_id,
                zone_events_written: runtimeSummary.zone_events_written,
              });
            }

            if (
              runtimeSummary.alerts_opened > 0 ||
              runtimeSummary.alerts_updated > 0 ||
              runtimeSummary.alerts_resolved > 0
            ) {
              broadcast("alerts_changed", {
                source: "scans/batch",
                store_id: runtimeSummary.store_id || store_id || null,
                opened: runtimeSummary.alerts_opened,
                updated: runtimeSummary.alerts_updated,
                resolved: runtimeSummary.alerts_resolved,
                alerts: runtimeSummary.alerts.slice(0, 20),
              });
            }
          }

          res.json({
            ok: true,
            batch,
            received: items.length,
            unique_tags_received: incomingTags.length,
            inserted: insertedTags.length,
            duplicates_ignored:
              Number(metrics.duplicate_count || 0) +
              Number(metrics.noisy_count || 0) +
              Number(metrics.pending_count || 0),
            metrics,
            runtime: runtimeSummary,
          });
        } catch (e) {
          await client.query("ROLLBACK");
          console.error("[scans/batch]", e);
          res.status(500).json({ ok: false, error: "Batch insert failed" });
        } finally {
          client.release();
        }
      } catch (err) {
        console.error("[scans/batch]", err);
        res.status(500).json({ ok: false, error: "Scan batch error" });
      }
    }
  );

  /* =========================
     POST /api/v1/scans/reset
     body: { store_id?: "STORE_001" }
     (ADMIN JWT ONLY)
  ========================= */
  router.post("/reset", authenticate, async (req, res) => {
    if (!isAdminUser(req)) {
      return res.status(403).json({ ok: false, error: "Admin required" });
    }

    const storeId = req.body?.store_id ? String(req.body.store_id) : null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await ensureDeviceZoneTables(client);

      let deletedItems = 0;
      let deletedBatches = 0;
      let deletedZoneEvents = 0;
      let deletedZoneSessions = 0;

      if (storeId) {
        const delItems = await client.query(
          `DELETE FROM scan_items WHERE store_id = $1`,
          [storeId]
        );
        deletedItems = delItems.rowCount || 0;

        const delBatches = await client.query(
          `DELETE FROM scan_batches WHERE store_id = $1`,
          [storeId]
        );
        deletedBatches = delBatches.rowCount || 0;

        const delZoneEvents = await client.query(
          `DELETE FROM zone_tag_events WHERE store_id = $1`,
          [storeId]
        );
        deletedZoneEvents = delZoneEvents.rowCount || 0;

        const delZoneSessions = await client.query(
          `DELETE FROM zone_tag_sessions WHERE store_id = $1`,
          [storeId]
        );
        deletedZoneSessions = delZoneSessions.rowCount || 0;
      } else {
        const delItems = await client.query(`DELETE FROM scan_items`);
        deletedItems = delItems.rowCount || 0;

        const delBatches = await client.query(`DELETE FROM scan_batches`);
        deletedBatches = delBatches.rowCount || 0;

        const delZoneEvents = await client.query(`DELETE FROM zone_tag_events`);
        deletedZoneEvents = delZoneEvents.rowCount || 0;

        const delZoneSessions = await client.query(`DELETE FROM zone_tag_sessions`);
        deletedZoneSessions = delZoneSessions.rowCount || 0;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        store_id: storeId,
        deleted_scan_items: deletedItems,
        deleted_scan_batches: deletedBatches,
        deleted_zone_tag_events: deletedZoneEvents,
        deleted_zone_tag_sessions: deletedZoneSessions,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[scans/reset]", err);
      return res.status(500).json({ ok: false, error: "Failed to reset scans" });
    } finally {
      client.release();
    }
  });

  return router;
};
