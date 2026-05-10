const express = require("express");
const jwt = require("jsonwebtoken");
const {
  parseDeviceZoneConfig,
  mergeDeviceZoneConfig,
  normalizeAntennaConfig,
  normalizeAlertRules,
  getSectionProfiles,
  getSectionProfile,
  ensureDeviceZoneTables,
} = require("./lib/deviceZones");
const {
  normalizeProvisioningIdentifiers,
  mergeDeviceProvisioningMetadata,
  buildClaimProvisioningPatch,
  parseDeviceProvisioning,
  PROVISIONING_STATES,
} = require("./lib/deviceProvisioning");

module.exports = function buildDevicesRoutes(pool) {
  const router = express.Router();

  /* =========================
     AUTH
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

  function optionalAuthenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return next();
    if (!auth.startsWith("Bearer ")) return next();

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function roleList(req) {
    const fromArray = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const fromSingle = req.user?.role ? [req.user.role] : [];
    return Array.from(
      new Set(
        [...fromArray, ...fromSingle]
          .map((r) => String(r || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }

  function isAdminUser(req) {
    const roles = roleList(req);
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function isGlobalAdmin(req) {
    return isAdminUser(req);
  }

  function getAllowedStores(req) {
    return Array.isArray(req.user?.store_ids) ? req.user.store_ids : [];
  }

  function canAccessStore(req, storeId) {
    if (!storeId) return isGlobalAdmin(req);
    if (isGlobalAdmin(req)) return true;

    const allowedStores = getAllowedStores(req);
    if (!allowedStores.length) return false;
    return allowedStores.includes(storeId);
  }

  function permissionList(req) {
    return Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  }

  function hasPermission(req, permission) {
    const permissions = permissionList(req);
    if (!permission) return false;
    return permissions.includes("*") || permissions.includes(permission);
  }

  function canManageDeviceSettings(req) {
    return isAdminUser(req) || hasPermission(req, "handheld.device_settings");
  }

  function requireAdmin(req, res, next) {
    if (isAdminUser(req)) return next();
    return res.status(403).json({ ok: false, error: "Admin required" });
  }

  function sanitizeDeviceRow(row, options = {}) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const zoneCfg = parseDeviceZoneConfig(metadata);
    const sectionProfile = String(
      metadata?.section_profile || metadata?.device_zones?.section_profile || ""
    )
      .trim()
      .toUpperCase();
    const provisioning = parseDeviceProvisioning(
      {
        ...row,
        metadata,
      },
      {
        heartbeat_minutes: options.heartbeat_minutes,
      }
    );

    return {
      ...row,
      metadata,
      section_profile: sectionProfile || null,
      alert_rules: zoneCfg.alert_rules,
      antenna_config: zoneCfg.antennas,
      display_name: String(row?.name || row?.device_id || ""),
      provisioning_state: provisioning.provisioning_state,
      connectivity_state: provisioning.connectivity_state,
      lifecycle_state: provisioning.lifecycle_state,
      claimed: provisioning.claimed,
      provisioning: provisioning.provisioning,
      connectivity: provisioning.connectivity,
      reader_identity: provisioning.reader_identity,
    };
  }

  /* =========================
     DEVICE KEY AUTH (for RFID readers)
  ========================= */
  function authenticateDeviceWriter(req, res, next) {
    if (req.user && isAdminUser(req)) return next();

    const key =
      req.headers["x-device-key"] ||
      req.headers["x-api-key"] ||
      req.headers["x-xandora-device-key"];

    const expected = process.env.DEVICE_API_KEY;

    if (!expected) {
      console.warn(
        "[devices] DEVICE_API_KEY not set. Blocking device write endpoints for safety."
      );
      return res.status(500).json({
        ok: false,
        error: "Server misconfigured (DEVICE_API_KEY missing)",
      });
    }

    if (!key || String(key).trim() !== String(expected).trim()) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden (admin or device key required)",
      });
    }

    return next();
  }

  async function loadDeviceRow(deviceId) {
    const result = await pool.query(
      `
      SELECT *
      FROM devices
      WHERE device_id = $1
      LIMIT 1
      `,
      [deviceId]
    );

    return result.rows[0] || null;
  }

  function hasKeys(obj) {
    return obj && typeof obj === "object" && Object.keys(obj).length > 0;
  }

  function asObject(value, fallback = {}) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : fallback;
  }

  /* =========================
     SECTION PROFILES
  ========================= */
  router.get("/section-profiles", authenticate, (_req, res) => {
    return res.json({
      ok: true,
      profiles: getSectionProfiles(),
    });
  });

  /* =========================
     LIST DEVICES
  ========================= */
  router.get("/", authenticate, async (req, res) => {
    try {
      const storeId = req.query.store_id ? String(req.query.store_id).trim() : null;
      const heartbeatMinutes = Math.min(
        Math.max(Number(req.query.heartbeat_minutes) || 3, 1),
        60
      );
      const where = [];
      const values = [];
      let i = 1;

      if (storeId) {
        if (!canAccessStore(req, storeId)) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }
        where.push(`store_id = $${i++}`);
        values.push(storeId);
      } else if (!isGlobalAdmin(req)) {
        const allowed = getAllowedStores(req);
        if (!allowed.length) {
          return res.json({ ok: true, devices: [], total: 0 });
        }
        where.push(`store_id = ANY($${i++}::text[])`);
        values.push(allowed);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const result = await pool.query(
        `
        SELECT *
        FROM devices
        ${whereSql}
        ORDER BY updated_at DESC
        `,
        values
      );

      const devices = result.rows.map((row) =>
        sanitizeDeviceRow(row, { heartbeat_minutes: heartbeatMinutes })
      );
      return res.json({
        ok: true,
        devices,
        total: devices.length,
      });
    } catch (err) {
      console.error("[list devices]", err);
      res.status(500).json({ ok: false, error: "Failed to fetch devices" });
    }
  });

  /* =========================
     DEVICE CONFIG
  ========================= */
  router.put("/:device_id/config", authenticate, requireAdmin, async (req, res) => {
    try {
      const deviceId = String(req.params.device_id || "").trim();
      if (!deviceId) {
        return res.status(400).json({ ok: false, error: "device_id required" });
      }

      const existing = await loadDeviceRow(deviceId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Device not found" });
      }

      const targetStoreId = String(
        req.body?.store_id || existing.store_id || ""
      ).trim();
      if (targetStoreId && !canAccessStore(req, targetStoreId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const existingMetadata =
        existing.metadata && typeof existing.metadata === "object"
          ? existing.metadata
          : {};
      const existingCfg = parseDeviceZoneConfig(existingMetadata);

      const requestedSectionProfile = String(
        req.body?.section_profile ||
          existingMetadata?.section_profile ||
          existingMetadata?.device_zones?.section_profile ||
          ""
      )
        .trim()
        .toUpperCase();
      const sectionProfile = getSectionProfile(requestedSectionProfile);

      const incomingAntennas = Array.isArray(req.body?.antennas)
        ? normalizeAntennaConfig(req.body.antennas)
        : existingCfg.antennas;

      let incomingAlertRules = req.body?.alert_rules
        ? normalizeAlertRules(req.body.alert_rules)
        : existingCfg.alert_rules;

      const applyProfileDefaults = req.body?.apply_profile_defaults !== false;
      if (sectionProfile && applyProfileDefaults) {
        incomingAlertRules = normalizeAlertRules(sectionProfile.default_alert_rules);
      }

      const mergedMetadata = mergeDeviceZoneConfig(existingMetadata, {
        antennas: incomingAntennas,
        alert_rules: incomingAlertRules,
      });

      mergedMetadata.section_profile = sectionProfile ? sectionProfile.id : null;
      mergedMetadata.device_zones = {
        ...(mergedMetadata.device_zones || {}),
        section_profile: sectionProfile ? sectionProfile.id : null,
      };

      const existingProvisioning = parseDeviceProvisioning(existing);
      const identityPatch = normalizeProvisioningIdentifiers({
        ...(req.body?.reader_identity || {}),
        ...(req.body?.identifiers || {}),
        serial_number: req.body?.serial_number ?? req.body?.reader_serial_number,
        mac_address: req.body?.mac_address ?? req.body?.reader_mac,
        model: req.body?.model ?? req.body?.reader_model,
        firmware_version: req.body?.firmware_version,
      });

      const explicitClaim = req.body?.claim_device === true;
      const skipAutoClaim = req.body?.claim_device === false;
      const shouldAutoClaim =
        !skipAutoClaim &&
        (explicitClaim ||
          existingProvisioning.provisioning_state === PROVISIONING_STATES.UNCLAIMED);

      if (shouldAutoClaim || hasKeys(identityPatch)) {
        const provisioningPatch = {
          identifiers: identityPatch,
        };

        if (shouldAutoClaim) {
          Object.assign(
            provisioningPatch,
            buildClaimProvisioningPatch({
              user_id: req.user?.user_id || null,
              email: req.user?.email || null,
              store_id: req.body?.store_id || existing.store_id || null,
              source: explicitClaim ? "ADMIN_EXPLICIT_CLAIM" : "ADMIN_CONFIG",
            })
          );
        }

        Object.assign(
          mergedMetadata,
          mergeDeviceProvisioningMetadata(mergedMetadata, provisioningPatch)
        );
      }

      const result = await pool.query(
        `
        UPDATE devices
        SET
          name = COALESCE($1, name),
          store_id = COALESCE($2, store_id),
          metadata = $3::jsonb,
          device_type = COALESCE($4, device_type),
          location_label = COALESCE($5, location_label),
          zone_label = COALESCE($6, zone_label),
          updated_at = NOW()
        WHERE device_id = $7
        RETURNING *
        `,
        [
          req.body?.name != null ? String(req.body.name) : null,
          req.body?.store_id != null ? String(req.body.store_id) : null,
          JSON.stringify(mergedMetadata),
          req.body?.device_type != null
            ? String(req.body.device_type).trim().toUpperCase() || null
            : null,
          req.body?.location_label != null
            ? String(req.body.location_label).trim() || null
            : null,
          req.body?.zone_label != null ? String(req.body.zone_label).trim() || null : null,
          deviceId,
        ]
      );

      return res.json({
        ok: true,
        device: sanitizeDeviceRow(result.rows[0]),
      });
    } catch (err) {
      console.error("[devices/config update]", err);
      return res.status(500).json({ ok: false, error: "Failed to update device config" });
    }
  });

  router.put("/:device_id/zone-assignment", authenticate, async (req, res) => {
    try {
      if (!canManageDeviceSettings(req)) {
        return res.status(403).json({
          ok: false,
          error: "Device settings permission required",
        });
      }

      const deviceId = String(req.params.device_id || "").trim();
      if (!deviceId) {
        return res.status(400).json({ ok: false, error: "device_id required" });
      }

      const existing = await loadDeviceRow(deviceId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Device not found" });
      }

      const targetStoreId = String(
        req.body?.store_id || existing.store_id || ""
      ).trim();
      if (targetStoreId && !canAccessStore(req, targetStoreId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const body = req.body || {};
      const existingMetadata =
        existing.metadata && typeof existing.metadata === "object"
          ? existing.metadata
          : {};
      const nextMetadata = {
        ...existingMetadata,
        device_zones: {
          ...asObject(existingMetadata.device_zones),
        },
      };

      const hasExplicitSectionProfile =
        Object.prototype.hasOwnProperty.call(body, "section_profile") ||
        Object.prototype.hasOwnProperty.call(body, "sectionProfile");
      const hasExplicitZoneLabel = Object.prototype.hasOwnProperty.call(body, "zone_label");
      const hasExplicitLocationLabel = Object.prototype.hasOwnProperty.call(
        body,
        "location_label"
      );

      let resolvedSectionProfile = null;
      if (hasExplicitSectionProfile) {
        const requestedSectionProfile = String(
          body.section_profile ?? body.sectionProfile ?? ""
        )
          .trim()
          .toUpperCase();
        resolvedSectionProfile = requestedSectionProfile
          ? getSectionProfile(requestedSectionProfile)
          : null;

        nextMetadata.section_profile = resolvedSectionProfile
          ? resolvedSectionProfile.id
          : null;
        nextMetadata.device_zones.section_profile = resolvedSectionProfile
          ? resolvedSectionProfile.id
          : null;
      }

      const zoneLabel = hasExplicitZoneLabel
        ? String(body.zone_label || "").trim() || null
        : hasExplicitSectionProfile
          ? resolvedSectionProfile?.label || null
          : null;
      const locationLabel = hasExplicitLocationLabel
        ? String(body.location_label || "").trim() || null
        : null;

      const result = await pool.query(
        `
        UPDATE devices
        SET
          store_id = COALESCE($1, store_id),
          metadata = $2::jsonb,
          zone_label = CASE WHEN $3 THEN $4 ELSE zone_label END,
          location_label = CASE WHEN $5 THEN $6 ELSE location_label END,
          updated_at = NOW()
        WHERE device_id = $7
        RETURNING *
        `,
        [
          targetStoreId || null,
          JSON.stringify(nextMetadata),
          hasExplicitZoneLabel || hasExplicitSectionProfile,
          zoneLabel,
          hasExplicitLocationLabel,
          locationLabel,
          deviceId,
        ]
      );

      return res.json({
        ok: true,
        device: sanitizeDeviceRow(result.rows[0]),
      });
    } catch (err) {
      console.error("[devices/zone-assignment]", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to update device zone",
      });
    }
  });

  /* =========================
     ANTENNA/READER HEALTH
  ========================= */
  router.get("/health", authenticate, async (req, res) => {
    try {
      await ensureDeviceZoneTables(pool);

      const storeId = req.query.store_id ? String(req.query.store_id).trim() : null;
      const heartbeatMinutes = Math.min(
        Math.max(Number(req.query.heartbeat_minutes) || 3, 1),
        60
      );
      const antennaIdleMinutes = Math.min(
        Math.max(Number(req.query.antenna_idle_minutes) || 10, 1),
        240
      );

      const where = [];
      const values = [];
      let i = 1;

      if (storeId) {
        if (!canAccessStore(req, storeId)) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }
        where.push(`d.store_id = $${i++}`);
        values.push(storeId);
      } else if (!isGlobalAdmin(req)) {
        const allowed = getAllowedStores(req);
        if (!allowed.length) {
          return res.json({ ok: true, count: 0, devices: [] });
        }
        where.push(`d.store_id = ANY($${i++}::text[])`);
        values.push(allowed);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const devicesRes = await pool.query(
        `
        SELECT d.*
        FROM devices d
        ${whereSql}
        ORDER BY d.updated_at DESC
        `,
        values
      );

      const deviceIds = devicesRes.rows.map((d) => d.device_id).filter(Boolean);
      if (!deviceIds.length) {
        return res.json({ ok: true, count: 0, devices: [] });
      }

      const antennaRes = await pool.query(
        `
        SELECT
          device_id,
          antenna_id,
          MAX(ts) AS last_seen_at,
          COUNT(*)::int AS reads
        FROM zone_tag_events
        WHERE device_id = ANY($1::text[])
          AND ts >= NOW() - INTERVAL '30 days'
        GROUP BY device_id, antenna_id
        `,
        [deviceIds]
      );

      const byDeviceAntenna = new Map();
      for (const row of antennaRes.rows) {
        const key = `${row.device_id}::${String(row.antenna_id || "")}`;
        byDeviceAntenna.set(key, row);
      }

      const nowMs = Date.now();
      const antennaIdleMs = antennaIdleMinutes * 60 * 1000;

      const out = devicesRes.rows.map((row) => {
        const device = sanitizeDeviceRow(row, { heartbeat_minutes: heartbeatMinutes });
        const readerOnline = Boolean(device?.connectivity?.online);

        const configured = Array.isArray(device.antenna_config)
          ? device.antenna_config
          : [];

        const antennaSet = new Map();
        for (const ant of configured) {
          antennaSet.set(Number(ant.antenna_id), ant);
        }

        for (const stat of antennaRes.rows) {
          if (stat.device_id !== row.device_id) continue;
          const antennaId = Number(stat.antenna_id || 0);
          if (!antennaId || antennaSet.has(antennaId)) continue;
          antennaSet.set(antennaId, {
            antenna_id: antennaId,
            name: `Antenna ${antennaId}`,
            zone_role: "UNASSIGNED",
            enabled: true,
          });
        }

        const antennas = Array.from(antennaSet.values())
          .sort((a, b) => a.antenna_id - b.antenna_id)
          .map((a) => {
            const stat = byDeviceAntenna.get(`${row.device_id}::${a.antenna_id}`) || null;
            const lastSeen = stat?.last_seen_at || null;
            const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;

            let status = "never_seen";
            if (lastSeenMs > 0) {
              status = nowMs - lastSeenMs <= antennaIdleMs ? "active" : "idle";
            }

            return {
              antenna_id: a.antenna_id,
              name: a.name,
              zone_role: a.zone_role,
              enabled: a.enabled !== false,
              status,
              reads_30d: Number(stat?.reads || 0),
              last_seen_at: lastSeen,
            };
          });

        return {
          device_id: row.device_id,
          name: row.name,
          display_name: device.display_name,
          store_id: row.store_id,
          status: row.status,
          reader_online: readerOnline,
          last_seen: row.last_seen,
          section_profile: device.section_profile,
          alert_rules: device.alert_rules,
          provisioning_state: device.provisioning_state,
          connectivity_state: device.connectivity_state,
          lifecycle_state: device.lifecycle_state,
          claimed: device.claimed,
          provisioning: device.provisioning,
          connectivity: device.connectivity,
          reader_identity: device.reader_identity,
          antennas,
        };
      });

      return res.json({
        ok: true,
        count: out.length,
        devices: out,
      });
    } catch (err) {
      console.error("[devices/health]", err);
      return res.status(500).json({ ok: false, error: "Failed to load device health" });
    }
  });

  /* =========================
     REGISTER DEVICE
  ========================= */
  router.post("/register", optionalAuthenticate, authenticateDeviceWriter, async (req, res) => {
    try {
      const { device_id, name, store_id, metadata } = req.body || {};

      if (!device_id) {
        return res.status(400).json({
          ok: false,
          error: "device_id is required",
        });
      }

      const incomingMetadata =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? metadata
          : {};
      const identityPatch = normalizeProvisioningIdentifiers({
        ...(req.body?.reader_identity || {}),
        ...(req.body?.identifiers || {}),
        serial_number: req.body?.serial_number ?? req.body?.reader_serial_number,
        mac_address: req.body?.mac_address ?? req.body?.reader_mac,
        model: req.body?.model ?? req.body?.reader_model,
        firmware_version: req.body?.firmware_version,
      });
      const isAdminWriter = Boolean(req.user && isAdminUser(req));

      let nextMetadata = hasKeys(incomingMetadata) ? incomingMetadata : null;
      if (hasKeys(identityPatch) || isAdminWriter) {
        const provisioningPatch = {
          identifiers: identityPatch,
        };
        if (isAdminWriter) {
          Object.assign(
            provisioningPatch,
            buildClaimProvisioningPatch({
              user_id: req.user?.user_id || null,
              email: req.user?.email || null,
              store_id: store_id || null,
              source: "ADMIN_REGISTER",
            })
          );
        }

        nextMetadata = mergeDeviceProvisioningMetadata(
          nextMetadata || {},
          provisioningPatch
        );
      }

      const result = await pool.query(
        `
        INSERT INTO devices (
          device_id,
          name,
          store_id,
          device_type,
          location_label,
          zone_label,
          status,
          last_seen,
          last_heartbeat,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'online', NOW(), NOW(), $7)
        ON CONFLICT (device_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          store_id = EXCLUDED.store_id,
          device_type = COALESCE(EXCLUDED.device_type, devices.device_type),
          location_label = COALESCE(EXCLUDED.location_label, devices.location_label),
          zone_label = COALESCE(EXCLUDED.zone_label, devices.zone_label),
          status = 'online',
          last_seen = NOW(),
          last_heartbeat = NOW(),
          metadata = COALESCE(EXCLUDED.metadata, devices.metadata),
          updated_at = NOW()
        RETURNING *
        `,
        [
          device_id,
          name || null,
          store_id || null,
          String(req.body?.device_type || "").trim().toUpperCase() || null,
          String(req.body?.location_label || "").trim() || null,
          String(req.body?.zone_label || "").trim() || null,
          nextMetadata || null,
        ]
      );

      return res.json({ ok: true, device: sanitizeDeviceRow(result.rows[0]) });
    } catch (err) {
      console.error("[register device]", err);
      res.status(500).json({ ok: false, error: "Failed to register device" });
    }
  });

  /* =========================
     HEARTBEAT
  ========================= */
  router.put("/heartbeat", optionalAuthenticate, authenticateDeviceWriter, async (req, res) => {
    try {
      const { device_id } = req.body || {};

      if (!device_id) {
        return res.status(400).json({
          ok: false,
          error: "device_id required",
        });
      }

      const result = await pool.query(
        `
        UPDATE devices
        SET status = 'online',
            last_seen = NOW(),
            last_heartbeat = NOW(),
            updated_at = NOW()
        WHERE device_id = $1
        RETURNING *
        `,
        [device_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Device not found" });
      }

      return res.json({ ok: true, device: sanitizeDeviceRow(result.rows[0]) });
    } catch (err) {
      console.error("[heartbeat]", err);
      res.status(500).json({ ok: false, error: "Failed to update heartbeat" });
    }
  });

  /* =========================
     UPDATE DEVICE (generic)
  ========================= */
  router.put("/update/:device_id", optionalAuthenticate, authenticateDeviceWriter, async (req, res) => {
    try {
      const { device_id } = req.params;
      const { name, store_id, metadata, status } = req.body || {};

      const incomingMetadata =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? metadata
          : null;
      let metadataPatch = incomingMetadata;
      if (incomingMetadata) {
        const incomingProvisioning = asObject(incomingMetadata.provisioning);
        const identityPatch = normalizeProvisioningIdentifiers({
          ...(incomingMetadata.reader_identity || {}),
          ...(incomingMetadata.identifiers || {}),
          serial_number:
            incomingMetadata.serial_number ||
            incomingMetadata.reader_serial_number,
          mac_address:
            incomingMetadata.mac_address || incomingMetadata.reader_mac,
          model: incomingMetadata.model || incomingMetadata.reader_model,
          firmware_version: incomingMetadata.firmware_version,
        });

        if (hasKeys(incomingProvisioning) || hasKeys(identityPatch)) {
          const nextProvisioning = mergeDeviceProvisioningMetadata(
            { provisioning: incomingProvisioning },
            {
              ...incomingProvisioning,
              identifiers: {
                ...normalizeProvisioningIdentifiers(
                  incomingProvisioning.identifiers || incomingProvisioning
                ),
                ...identityPatch,
              },
            }
          ).provisioning;

          metadataPatch = {
            ...incomingMetadata,
            provisioning: nextProvisioning,
          };
        }
      }

      const result = await pool.query(
        `
        UPDATE devices
        SET name = COALESCE($1, name),
            store_id = COALESCE($2, store_id),
            metadata = CASE
              WHEN $3::jsonb IS NULL THEN metadata
              ELSE COALESCE(metadata, '{}'::jsonb) || $3::jsonb
            END,
            status = COALESCE($4, status),
            device_type = COALESCE($5, device_type),
            location_label = COALESCE($6, location_label),
            zone_label = COALESCE($7, zone_label),
            updated_at = NOW()
        WHERE device_id = $8
        RETURNING *
        `,
        [
          name ?? null,
          store_id ?? null,
          metadataPatch ?? null,
          status ?? null,
          req.body?.device_type != null
            ? String(req.body.device_type).trim().toUpperCase() || null
            : null,
          req.body?.location_label != null
            ? String(req.body.location_label).trim() || null
            : null,
          req.body?.zone_label != null ? String(req.body.zone_label).trim() || null : null,
          device_id,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Device not found" });
      }

      return res.json({ ok: true, device: sanitizeDeviceRow(result.rows[0]) });
    } catch (err) {
      console.error("[update device]", err);
      res.status(500).json({ ok: false, error: "Failed to update device" });
    }
  });

  /* =========================
     DELETE DEVICE
  ========================= */
  router.delete("/:device_id", optionalAuthenticate, authenticateDeviceWriter, async (req, res) => {
    try {
      const { device_id } = req.params;

      const result = await pool.query(
        `
        DELETE FROM devices
        WHERE device_id = $1
        RETURNING *
        `,
        [device_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Device not found" });
      }

      return res.json({ ok: true, deleted: result.rows[0] });
    } catch (err) {
      console.error("[delete device]", err);
      res.status(500).json({ ok: false, error: "Failed to delete device" });
    }
  });

  return router;
};
