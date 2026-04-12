// src/api/routes/alerts.js
const express = require("express");
const jwt = require("jsonwebtoken");
const {
  CASE_STATUS_OPTIONS,
  CASE_PRIORITY_OPTIONS,
  isCaseStatus,
  isCasePriority,
  normalizeCaseStatus,
  normalizeCasePriority,
  normalizeOptionalText,
  normalizeRequiredText,
  buildCaseRef,
  sanitizeCaseRow,
  ensureIncidentCaseTables,
} = require("./lib/incidentCases");

module.exports = function buildAlertsRoutes(pool) {
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

  function roleList(req) {
    const roleListRaw = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const singleRole = req.user?.role ? [req.user.role] : [];
    return Array.from(
      new Set(
        [...roleListRaw, ...singleRole]
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

  function canReadAlerts(req) {
    return (
      isAdminUser(req) ||
      hasPermission(req, "alerts.receive") ||
      hasPermission(req, "dashboard.view_alerts")
    );
  }

  function requireAlertRead(req, res, next) {
    if (canReadAlerts(req)) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      error: "Alerts are not enabled for this user.",
    });
  }

  function requireAdminWrite(req, res, next) {
    const method = String(req.method || "GET").toUpperCase();
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (!isWrite) return next();

    if (!isAdminUser(req)) {
      return res.status(403).json({
        ok: false,
        error: "Read-only access. Admin required for changes.",
      });
    }

    next();
  }

  function actorFromReq(req) {
    return {
      user_id: Number(req.user?.user_id) || null,
      email: String(req.user?.email || "").trim().toLowerCase() || null,
    };
  }

  function toIntOrNull(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function asObject(value, fallback = {}) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : fallback;
  }

  let alertColumnsCache = null;
  let alertColumnsCacheTs = 0;
  let alertsUpdatedAtEnsureAttempted = false;

  function isMissingUpdatedAtTriggerError(err) {
    const code = String(err?.code || "");
    const message = String(err?.message || "").toLowerCase();
    return (
      code === "42703" &&
      message.includes('record "new"') &&
      message.includes("updated_at")
    );
  }

  async function loadAlertColumns() {
    const r = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'alerts'
      `
    );
    return new Set(r.rows.map((row) => String(row.column_name || "")));
  }

  async function ensureAlertsUpdatedAtColumn(currentColumns = new Set()) {
    if (currentColumns.has("updated_at")) {
      return currentColumns;
    }
    if (alertsUpdatedAtEnsureAttempted) {
      return currentColumns;
    }

    alertsUpdatedAtEnsureAttempted = true;
    try {
      await pool.query(`
        ALTER TABLE alerts
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);
      const refreshed = await loadAlertColumns();
      return refreshed.size > 0 ? refreshed : currentColumns;
    } catch (err) {
      console.warn(
        "[alerts] failed to ensure alerts.updated_at compatibility:",
        err.message
      );
      return currentColumns;
    }
  }

  async function getAlertColumns(force = false) {
    if (!force && alertColumnsCache && Date.now() - alertColumnsCacheTs < 30000) {
      return alertColumnsCache;
    }

    let cols = await loadAlertColumns();
    cols = await ensureAlertsUpdatedAtColumn(cols);
    alertColumnsCache = cols;
    alertColumnsCacheTs = Date.now();
    return alertColumnsCache;
  }

  function optionalAlertColumnExpr(columnSet, tableAlias, columnName, fallbackSql, asName) {
    const alias = String(asName || columnName);
    const colRef = tableAlias ? `${tableAlias}.${columnName}` : columnName;
    if (columnSet.has(columnName)) {
      return alias === columnName ? colRef : `${colRef} AS ${alias}`;
    }
    return `${fallbackSql} AS ${alias}`;
  }

  function resolvePriorityFromAlert(alertRow, fallbackPriority) {
    if (isCasePriority(fallbackPriority)) {
      return normalizeCasePriority(fallbackPriority);
    }

    const severity = Number(alertRow?.severity);
    if (!Number.isFinite(severity)) return "MEDIUM";
    if (severity >= 80) return "CRITICAL";
    if (severity >= 60) return "HIGH";
    if (severity >= 30) return "MEDIUM";
    return "LOW";
  }

  async function insertCaseEvent(client, caseId, eventType, actor, note, payload = {}) {
    await client.query(
      `
      INSERT INTO alert_case_events (
        case_id,
        event_type,
        note,
        actor_user_id,
        actor_email,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        caseId,
        String(eventType || "UPDATED"),
        normalizeOptionalText(note, 4000),
        actor?.user_id || null,
        actor?.email || null,
        JSON.stringify(asObject(payload)),
      ]
    );
  }

  async function fetchAlertById(alertId) {
    const alertCols = await getAlertColumns();
    const metadataExpr = optionalAlertColumnExpr(
      alertCols,
      "a",
      "metadata",
      "'{}'::jsonb",
      "metadata"
    );
    const firstDetectedExpr = optionalAlertColumnExpr(
      alertCols,
      "a",
      "first_detected_at",
      "NULL::timestamptz",
      "first_detected_at"
    );
    const lastDetectedExpr = optionalAlertColumnExpr(
      alertCols,
      "a",
      "last_detected_at",
      "NULL::timestamptz",
      "last_detected_at"
    );
    const resolvedAtExpr = optionalAlertColumnExpr(
      alertCols,
      "a",
      "resolved_at",
      "NULL::timestamptz",
      "resolved_at"
    );

    const r = await pool.query(
      `
      SELECT
        a.id,
        a.type,
        a.entity_type,
        a.entity_id,
        a.store_id,
        a.severity,
        a.status,
        ${metadataExpr},
        ${firstDetectedExpr},
        ${lastDetectedExpr},
        ${resolvedAtExpr}
      FROM alerts a
      WHERE a.id = $1
      LIMIT 1
      `,
      [alertId]
    );

    return r.rows[0] || null;
  }

  async function fetchCaseById(caseId, client = pool) {
    const alertCols = await getAlertColumns();
    const alertMetadataExpr = optionalAlertColumnExpr(
      alertCols,
      "a",
      "metadata",
      "'{}'::jsonb",
      "alert_metadata"
    );

    const r = await client.query(
      `
      SELECT
        c.id,
        c.case_ref,
        c.alert_id,
        c.store_id,
        c.status,
        c.priority,
        c.title,
        c.description,
        c.assigned_to_user_id,
        c.assigned_to_email,
        c.assigned_to_name,
        c.created_by_user_id,
        c.created_by_email,
        c.resolution_notes,
        c.resolved_at,
        c.metadata,
        c.created_at,
        c.updated_at,
        a.type AS alert_type,
        a.entity_type AS alert_entity_type,
        a.entity_id AS alert_entity_id,
        a.severity AS alert_severity,
        a.status AS alert_status,
        ${alertMetadataExpr},
        COALESCE(ev.event_count, 0)::int AS event_count
      FROM alert_cases c
      LEFT JOIN alerts a
        ON a.id = c.alert_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS event_count
        FROM alert_case_events e
        WHERE e.case_id = c.id
      ) ev ON TRUE
      WHERE c.id = $1
      LIMIT 1
      `,
      [caseId]
    );

    return sanitizeCaseRow(r.rows[0] || null);
  }

  async function fetchCaseEvents(caseId, limit = 200) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const r = await pool.query(
      `
      SELECT
        id,
        case_id,
        event_type,
        note,
        actor_user_id,
        actor_email,
        payload,
        created_at
      FROM alert_case_events
      WHERE case_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [caseId, safeLimit]
    );

    return r.rows.map((row) => ({
      ...row,
      payload: asObject(row.payload),
    }));
  }

  router.use(authenticate);
  router.use(requireAlertRead);
  router.use(requireAdminWrite);

  /* =========================
     GET ALERTS (LIST)
  ========================= */
  router.get("/", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit || 100), 500);
      const offset = Math.max(Number(req.query.offset || 0), 0);

      const storeId = req.query.store_id || null;
      const status = req.query.status || null;
      const severity = req.query.severity || null;
      const type = req.query.type || null;

      const where = [];
      const values = [];
      let i = 1;

      if (storeId && !canAccessStore(req, String(storeId))) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      if (storeId) {
        where.push(`a.store_id = $${i++}`);
        values.push(storeId);
      } else if (!isGlobalAdmin(req)) {
        const allowedStores = getAllowedStores(req);
        if (!allowedStores.length) {
          return res.json({ ok: true, count: 0, alerts: [] });
        }
        where.push(`a.store_id = ANY($${i++}::text[])`);
        values.push(allowedStores);
      }
      if (status) {
        where.push(`a.status = $${i++}`);
        values.push(status);
      }
      if (severity) {
        where.push(`a.severity = $${i++}`);
        values.push(severity);
      }
      if (type) {
        where.push(`a.type = $${i++}`);
        values.push(type);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const alertCols = await getAlertColumns();
      const metadataExpr = optionalAlertColumnExpr(
        alertCols,
        "a",
        "metadata",
        "'{}'::jsonb",
        "metadata"
      );
      const firstDetectedExpr = optionalAlertColumnExpr(
        alertCols,
        "a",
        "first_detected_at",
        "NULL::timestamptz",
        "first_detected_at"
      );
      const lastDetectedExpr = optionalAlertColumnExpr(
        alertCols,
        "a",
        "last_detected_at",
        "NULL::timestamptz",
        "last_detected_at"
      );
      const resolvedAtExpr = optionalAlertColumnExpr(
        alertCols,
        "a",
        "resolved_at",
        "NULL::timestamptz",
        "resolved_at"
      );
      const orderByRecentExpr = alertCols.has("last_detected_at")
        ? "a.last_detected_at DESC"
        : "a.id DESC";

      let includeCaseSummary = true;
      try {
        await ensureIncidentCaseTables(pool);
      } catch (e) {
        includeCaseSummary = false;
        console.warn("[alerts] case summary disabled:", e.message);
      }

      const caseSelect = includeCaseSummary
        ? `
          COALESCE(cs.open_case_count, 0)::int AS open_case_count,
          cs.latest_case_id,
          cs.latest_case_ref,
          cs.latest_case_status,
        `
        : `
          0::int AS open_case_count,
          NULL::bigint AS latest_case_id,
          NULL::text AS latest_case_ref,
          NULL::text AS latest_case_status,
        `;

      const caseJoin = includeCaseSummary
        ? `
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) FILTER (WHERE c.status IN ('OPEN', 'IN_PROGRESS'))::int AS open_case_count,
              (ARRAY_AGG(c.id ORDER BY c.updated_at DESC, c.id DESC))[1] AS latest_case_id,
              (ARRAY_AGG(c.case_ref ORDER BY c.updated_at DESC, c.id DESC))[1] AS latest_case_ref,
              (ARRAY_AGG(c.status ORDER BY c.updated_at DESC, c.id DESC))[1] AS latest_case_status
            FROM alert_cases c
            WHERE c.alert_id = a.id
          ) cs ON TRUE
        `
        : "";

      const sql = `
        SELECT
          a.id,
          a.type,
          a.entity_type,
          a.entity_id,
          a.store_id,
          a.severity,
          a.status,
          ${firstDetectedExpr},
          ${lastDetectedExpr},
          ${resolvedAtExpr},
          ${caseSelect}
          ${metadataExpr}
        FROM alerts a
        ${caseJoin}
        ${whereSql}
        ORDER BY
          a.status = 'OPEN' DESC,
          ${orderByRecentExpr}
        LIMIT $${i++} OFFSET $${i++}
      `;

      values.push(limit, offset);

      const r = await pool.query(sql, values);

      return res.json({
        ok: true,
        count: r.rowCount,
        alerts: r.rows.map((row) => ({
          ...row,
          metadata: asObject(row.metadata),
        })),
      });
    } catch (err) {
      console.error("[alerts] list error:", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch alerts" });
    }
  });

  /* =========================
     INCIDENT CASES
  ========================= */
  router.get("/cases", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const storeId = req.query.store_id ? String(req.query.store_id).trim() : "";
      const status = req.query.status ? String(req.query.status).trim().toUpperCase() : "";
      const priority = req.query.priority
        ? String(req.query.priority).trim().toUpperCase()
        : "";
      const q = req.query.q ? String(req.query.q).trim() : "";
      const assignedToMe =
        String(req.query.assigned_to_me || "").trim().toLowerCase() === "true";

      if (storeId && !canAccessStore(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const where = [];
      const values = [];
      let i = 1;

      if (storeId) {
        where.push(`c.store_id = $${i++}`);
        values.push(storeId);
      } else if (!isGlobalAdmin(req)) {
        const allowedStores = getAllowedStores(req);
        if (!allowedStores.length) {
          return res.json({ ok: true, count: 0, cases: [] });
        }
        where.push(`c.store_id = ANY($${i++}::text[])`);
        values.push(allowedStores);
      }

      if (status) {
        if (!isCaseStatus(status)) {
          return res.status(400).json({
            ok: false,
            error: `status must be one of ${CASE_STATUS_OPTIONS.join(", ")}`,
          });
        }
        where.push(`c.status = $${i++}`);
        values.push(status);
      }

      if (priority) {
        if (!isCasePriority(priority)) {
          return res.status(400).json({
            ok: false,
            error: `priority must be one of ${CASE_PRIORITY_OPTIONS.join(", ")}`,
          });
        }
        where.push(`c.priority = $${i++}`);
        values.push(priority);
      }

      if (assignedToMe) {
        const actor = actorFromReq(req);
        if (!actor.user_id && !actor.email) {
          return res.json({ ok: true, count: 0, cases: [] });
        }
        const userClause = actor.user_id ? `c.assigned_to_user_id = $${i++}` : "FALSE";
        const emailClause = actor.email ? `c.assigned_to_email = $${i++}` : "FALSE";
        const clauses = [userClause, emailClause].filter((c0) => c0 !== "FALSE");
        if (!clauses.length) {
          return res.json({ ok: true, count: 0, cases: [] });
        }
        where.push(`(${clauses.join(" OR ")})`);
        if (actor.user_id) values.push(actor.user_id);
        if (actor.email) values.push(actor.email);
      }

      if (q) {
        where.push(
          `(c.case_ref ILIKE $${i} OR c.title ILIKE $${i} OR COALESCE(c.description, '') ILIKE $${i} OR COALESCE(a.entity_id, '') ILIKE $${i})`
        );
        values.push(`%${q}%`);
        i += 1;
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          c.id,
          c.case_ref,
          c.alert_id,
          c.store_id,
          c.status,
          c.priority,
          c.title,
          c.description,
          c.assigned_to_user_id,
          c.assigned_to_email,
          c.assigned_to_name,
          c.created_by_user_id,
          c.created_by_email,
          c.resolution_notes,
          c.resolved_at,
          c.metadata,
          c.created_at,
          c.updated_at,
          a.type AS alert_type,
          a.entity_type AS alert_entity_type,
          a.entity_id AS alert_entity_id,
          a.severity AS alert_severity,
          a.status AS alert_status,
          COALESCE(ev.event_count, 0)::int AS event_count
        FROM alert_cases c
        LEFT JOIN alerts a
          ON a.id = c.alert_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS event_count
          FROM alert_case_events e
          WHERE e.case_id = c.id
        ) ev ON TRUE
        ${whereSql}
        ORDER BY
          CASE c.status
            WHEN 'OPEN' THEN 0
            WHEN 'IN_PROGRESS' THEN 1
            ELSE 2
          END,
          c.updated_at DESC,
          c.id DESC
        LIMIT $${i++} OFFSET $${i++}
      `;

      values.push(limit, offset);
      const result = await pool.query(sql, values);

      return res.json({
        ok: true,
        count: result.rowCount,
        cases: result.rows.map(sanitizeCaseRow),
      });
    } catch (err) {
      console.error("[alerts/cases list]", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch cases" });
    }
  });

  router.get("/cases/:id", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const caseId = toIntOrNull(req.params.id);
      if (!caseId) {
        return res.status(400).json({ ok: false, error: "Invalid case id" });
      }

      const caseRow = await fetchCaseById(caseId);
      if (!caseRow) {
        return res.status(404).json({ ok: false, error: "Case not found" });
      }

      if (!canAccessStore(req, caseRow.store_id ? String(caseRow.store_id) : null)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const events = await fetchCaseEvents(caseId, req.query.events_limit);

      return res.json({
        ok: true,
        case: caseRow,
        events,
      });
    } catch (err) {
      console.error("[alerts/cases get]", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch case" });
    }
  });

  router.post("/cases", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const actor = actorFromReq(req);
      const storeId = String(req.body?.store_id || "").trim();
      const title = normalizeRequiredText(req.body?.title, 240);
      const description = normalizeOptionalText(req.body?.description, 4000);
      const metadata = asObject(req.body?.metadata);
      const alertId = toIntOrNull(req.body?.alert_id);
      const priority = normalizeCasePriority(req.body?.priority, "MEDIUM");
      const status = normalizeCaseStatus(req.body?.status, "OPEN");
      const assignedToUserId = toIntOrNull(req.body?.assigned_to_user_id);
      const assignedToEmail = normalizeOptionalText(req.body?.assigned_to_email, 240);
      const assignedToName = normalizeOptionalText(req.body?.assigned_to_name, 240);

      if (!storeId) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }
      if (!title) {
        return res.status(400).json({ ok: false, error: "title required" });
      }
      if (!canAccessStore(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      if (alertId) {
        const alertRow = await fetchAlertById(alertId);
        if (!alertRow) {
          return res.status(404).json({ ok: false, error: "Alert not found" });
        }
        if (!canAccessStore(req, alertRow.store_id ? String(alertRow.store_id) : null)) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }
        if (alertRow.store_id && String(alertRow.store_id) !== storeId) {
          return res.status(400).json({
            ok: false,
            error: "store_id must match linked alert store",
          });
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertCase = await client.query(
          `
          INSERT INTO alert_cases (
            case_ref,
            alert_id,
            store_id,
            status,
            priority,
            title,
            description,
            assigned_to_user_id,
            assigned_to_email,
            assigned_to_name,
            created_by_user_id,
            created_by_email,
            resolved_at,
            metadata
          )
          VALUES (
            NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            CASE WHEN $3 = 'RESOLVED' THEN NOW() ELSE NULL END,
            $12::jsonb
          )
          RETURNING id
          `,
          [
            alertId,
            storeId,
            status,
            priority,
            title,
            description,
            assignedToUserId,
            assignedToEmail,
            assignedToName,
            actor.user_id,
            actor.email,
            JSON.stringify(metadata),
          ]
        );

        const caseId = Number(insertCase.rows[0].id);
        const caseRef = buildCaseRef(caseId);

        await client.query(
          `
          UPDATE alert_cases
          SET case_ref = $1,
              updated_at = NOW()
          WHERE id = $2
          `,
          [caseRef, caseId]
        );

        await insertCaseEvent(client, caseId, "CREATED", actor, "Case created", {
          status,
          priority,
        });

        if (alertId) {
          await insertCaseEvent(
            client,
            caseId,
            "ALERT_LINKED",
            actor,
            "Linked to alert",
            { alert_id: alertId }
          );
        }

        if (assignedToUserId || assignedToEmail || assignedToName) {
          await insertCaseEvent(
            client,
            caseId,
            "ASSIGNED",
            actor,
            "Case assigned",
            {
              assigned_to_user_id: assignedToUserId,
              assigned_to_email: assignedToEmail,
              assigned_to_name: assignedToName,
            }
          );
        }

        await client.query("COMMIT");

        const out = await fetchCaseById(caseId);
        return res.json({ ok: true, case: out });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[alerts/cases create]", err);
      return res.status(500).json({ ok: false, error: "Failed to create case" });
    }
  });

  router.post("/cases/from-alert/:alert_id", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const actor = actorFromReq(req);
      const alertId = toIntOrNull(req.params.alert_id);
      if (!alertId) {
        return res.status(400).json({ ok: false, error: "Invalid alert id" });
      }

      const alertRow = await fetchAlertById(alertId);
      if (!alertRow) {
        return res.status(404).json({ ok: false, error: "Alert not found" });
      }

      if (!canAccessStore(req, alertRow.store_id ? String(alertRow.store_id) : null)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const storeId = String(
        req.body?.store_id || alertRow.store_id || ""
      ).trim();
      if (!storeId) {
        return res.status(400).json({
          ok: false,
          error: "store_id required for alerts without store scope",
        });
      }
      if (!canAccessStore(req, storeId)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const existing = await pool.query(
        `
        SELECT id
        FROM alert_cases
        WHERE alert_id = $1
          AND status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        `,
        [alertId]
      );

      if (existing.rowCount) {
        const existingCase = await fetchCaseById(existing.rows[0].id);
        return res.json({
          ok: true,
          existing: true,
          case: existingCase,
        });
      }

      const autoTitle = normalizeRequiredText(
        `${String(alertRow.type || "ALERT")} - ${String(
          alertRow.entity_type || "entity"
        )}:${String(alertRow.entity_id || alertRow.id)}`,
        240
      );

      const title = normalizeRequiredText(req.body?.title, 240) || autoTitle;
      const description =
        normalizeOptionalText(req.body?.description, 4000) ||
        normalizeOptionalText(
          `Alert detected at ${alertRow.last_detected_at || alertRow.first_detected_at || "unknown time"}`,
          4000
        );

      const priority = resolvePriorityFromAlert(alertRow, req.body?.priority);
      const assignToMe =
        String(req.body?.assign_to_me || "").trim().toLowerCase() === "true";

      const assignedToUserId = assignToMe
        ? actor.user_id
        : toIntOrNull(req.body?.assigned_to_user_id);
      const assignedToEmail = assignToMe
        ? actor.email
        : normalizeOptionalText(req.body?.assigned_to_email, 240);
      const assignedToName = normalizeOptionalText(req.body?.assigned_to_name, 240);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertCase = await client.query(
          `
          INSERT INTO alert_cases (
            case_ref,
            alert_id,
            store_id,
            status,
            priority,
            title,
            description,
            assigned_to_user_id,
            assigned_to_email,
            assigned_to_name,
            created_by_user_id,
            created_by_email,
            metadata
          )
          VALUES (NULL, $1, $2, 'OPEN', $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
          RETURNING id
          `,
          [
            alertId,
            storeId,
            priority,
            title,
            description,
            assignedToUserId,
            assignedToEmail,
            assignedToName,
            actor.user_id,
            actor.email,
            JSON.stringify({
              created_from_alert: true,
              alert_status: alertRow.status,
              alert_type: alertRow.type,
            }),
          ]
        );

        const caseId = Number(insertCase.rows[0].id);
        const caseRef = buildCaseRef(caseId);

        await client.query(
          `
          UPDATE alert_cases
          SET case_ref = $1,
              updated_at = NOW()
          WHERE id = $2
          `,
          [caseRef, caseId]
        );

        await insertCaseEvent(client, caseId, "CREATED", actor, "Case created from alert", {
          alert_id: alertId,
          priority,
        });

        await insertCaseEvent(client, caseId, "ALERT_LINKED", actor, "Linked to alert", {
          alert_id: alertId,
          alert_type: alertRow.type,
          alert_entity_type: alertRow.entity_type,
          alert_entity_id: alertRow.entity_id,
        });

        if (assignedToUserId || assignedToEmail || assignedToName) {
          await insertCaseEvent(client, caseId, "ASSIGNED", actor, "Case assigned", {
            assigned_to_user_id: assignedToUserId,
            assigned_to_email: assignedToEmail,
            assigned_to_name: assignedToName,
          });
        }

        await client.query("COMMIT");

        const out = await fetchCaseById(caseId);
        return res.json({ ok: true, existing: false, case: out });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[alerts/cases from-alert]", err);
      return res.status(500).json({ ok: false, error: "Failed to create case from alert" });
    }
  });

  router.put("/cases/:id", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const caseId = toIntOrNull(req.params.id);
      if (!caseId) {
        return res.status(400).json({ ok: false, error: "Invalid case id" });
      }

      const actor = actorFromReq(req);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          `
          SELECT *
          FROM alert_cases
          WHERE id = $1
          FOR UPDATE
          `,
          [caseId]
        );

        if (!lockRes.rowCount) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "Case not found" });
        }

        const current = sanitizeCaseRow(lockRes.rows[0]);
        if (!canAccessStore(req, current.store_id ? String(current.store_id) : null)) {
          await client.query("ROLLBACK");
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }

        if (req.body?.status != null) {
          const nextStatusRaw = String(req.body.status || "").trim().toUpperCase();
          if (!isCaseStatus(nextStatusRaw)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              error: `status must be one of ${CASE_STATUS_OPTIONS.join(", ")}`,
            });
          }
        }
        if (req.body?.priority != null) {
          const nextPriorityRaw = String(req.body.priority || "").trim().toUpperCase();
          if (!isCasePriority(nextPriorityRaw)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              error: `priority must be one of ${CASE_PRIORITY_OPTIONS.join(", ")}`,
            });
          }
        }

        const nextStatus =
          req.body?.status != null
            ? normalizeCaseStatus(req.body.status, current.status)
            : normalizeCaseStatus(current.status);

        const nextPriority =
          req.body?.priority != null
            ? normalizeCasePriority(req.body.priority, current.priority)
            : normalizeCasePriority(current.priority);

        const nextTitle =
          req.body?.title != null
            ? normalizeRequiredText(req.body.title, 240) || current.title
            : current.title;
        const nextDescription =
          req.body?.description != null
            ? normalizeOptionalText(req.body.description, 4000)
            : current.description;
        const nextAssignedToUserId =
          req.body?.assigned_to_user_id != null
            ? toIntOrNull(req.body.assigned_to_user_id)
            : current.assigned_to_user_id;
        const nextAssignedToEmail =
          req.body?.assigned_to_email != null
            ? normalizeOptionalText(req.body.assigned_to_email, 240)
            : current.assigned_to_email;
        const nextAssignedToName =
          req.body?.assigned_to_name != null
            ? normalizeOptionalText(req.body.assigned_to_name, 240)
            : current.assigned_to_name;
        const nextResolutionNotes =
          req.body?.resolution_notes != null
            ? normalizeOptionalText(req.body.resolution_notes, 4000)
            : current.resolution_notes;
        const nextMetadata =
          req.body?.metadata != null ? asObject(req.body.metadata) : asObject(current.metadata);

        let nextResolvedAt = current.resolved_at;
        if (nextStatus === "RESOLVED" && !current.resolved_at) {
          nextResolvedAt = new Date().toISOString();
        } else if (nextStatus !== "RESOLVED") {
          nextResolvedAt = null;
        }

        await client.query(
          `
          UPDATE alert_cases
          SET
            status = $1,
            priority = $2,
            title = $3,
            description = $4,
            assigned_to_user_id = $5,
            assigned_to_email = $6,
            assigned_to_name = $7,
            resolution_notes = $8,
            resolved_at = $9,
            metadata = $10::jsonb,
            updated_at = NOW()
          WHERE id = $11
          `,
          [
            nextStatus,
            nextPriority,
            nextTitle,
            nextDescription,
            nextAssignedToUserId,
            nextAssignedToEmail,
            nextAssignedToName,
            nextResolutionNotes,
            nextResolvedAt,
            JSON.stringify(nextMetadata),
            caseId,
          ]
        );

        const changed = {};
        if (nextStatus !== current.status) {
          changed.status = { from: current.status, to: nextStatus };
        }
        if (nextPriority !== current.priority) {
          changed.priority = { from: current.priority, to: nextPriority };
        }
        if (nextTitle !== current.title) {
          changed.title = { from: current.title, to: nextTitle };
        }
        if ((nextDescription || null) !== (current.description || null)) {
          changed.description = true;
        }
        if ((nextResolutionNotes || null) !== (current.resolution_notes || null)) {
          changed.resolution_notes = true;
        }
        if (JSON.stringify(nextMetadata) !== JSON.stringify(asObject(current.metadata))) {
          changed.metadata = true;
        }

        const currentAssign = JSON.stringify({
          user_id: current.assigned_to_user_id || null,
          email: current.assigned_to_email || null,
          name: current.assigned_to_name || null,
        });
        const nextAssign = JSON.stringify({
          user_id: nextAssignedToUserId || null,
          email: nextAssignedToEmail || null,
          name: nextAssignedToName || null,
        });

        if (currentAssign !== nextAssign) {
          await insertCaseEvent(client, caseId, "ASSIGNED", actor, "Case assignment updated", {
            assigned_to_user_id: nextAssignedToUserId,
            assigned_to_email: nextAssignedToEmail,
            assigned_to_name: nextAssignedToName,
          });
        }

        if (changed.status) {
          const eventType =
            nextStatus === "RESOLVED"
              ? "RESOLVED"
              : current.status === "RESOLVED" && nextStatus !== "RESOLVED"
              ? "REOPENED"
              : "STATUS_CHANGED";

          const eventNote =
            eventType === "RESOLVED"
              ? "Case resolved"
              : eventType === "REOPENED"
              ? "Case reopened"
              : "Case status updated";

          await insertCaseEvent(client, caseId, eventType, actor, eventNote, {
            from: current.status,
            to: nextStatus,
            resolution_notes: nextResolutionNotes || null,
          });
        }

        const changedKeys = Object.keys(changed).filter((k) => k !== "status");
        if (changedKeys.length > 0) {
          await insertCaseEvent(client, caseId, "UPDATED", actor, "Case details updated", {
            changed_fields: changedKeys,
          });
        }

        await client.query("COMMIT");

        const out = await fetchCaseById(caseId);
        return res.json({ ok: true, case: out });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[alerts/cases update]", err);
      return res.status(500).json({ ok: false, error: "Failed to update case" });
    }
  });

  router.post("/cases/:id/notes", async (req, res) => {
    try {
      await ensureIncidentCaseTables(pool);

      const caseId = toIntOrNull(req.params.id);
      if (!caseId) {
        return res.status(400).json({ ok: false, error: "Invalid case id" });
      }

      const note = normalizeRequiredText(req.body?.note, 4000);
      if (!note) {
        return res.status(400).json({ ok: false, error: "note required" });
      }

      const caseRow = await fetchCaseById(caseId);
      if (!caseRow) {
        return res.status(404).json({ ok: false, error: "Case not found" });
      }
      if (!canAccessStore(req, caseRow.store_id ? String(caseRow.store_id) : null)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const actor = actorFromReq(req);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const eventRes = await client.query(
          `
          INSERT INTO alert_case_events (
            case_id,
            event_type,
            note,
            actor_user_id,
            actor_email,
            payload
          )
          VALUES ($1, 'COMMENT', $2, $3, $4, '{}'::jsonb)
          RETURNING *
          `,
          [caseId, note, actor.user_id, actor.email]
        );

        await client.query(
          `
          UPDATE alert_cases
          SET updated_at = NOW()
          WHERE id = $1
          `,
          [caseId]
        );

        await client.query("COMMIT");

        return res.json({
          ok: true,
          event: {
            ...eventRes.rows[0],
            payload: asObject(eventRes.rows[0]?.payload),
          },
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[alerts/cases note]", err);
      return res.status(500).json({ ok: false, error: "Failed to add case note" });
    }
  });

  /* =========================
     GET ALERT BY ID
  ========================= */
  router.get("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: "Invalid alert id" });
      }

      const alert = await fetchAlertById(id);
      if (!alert) {
        return res.status(404).json({ ok: false, error: "Alert not found" });
      }

      if (!canAccessStore(req, alert.store_id ? String(alert.store_id) : null)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      let linkedCases = [];
      try {
        await ensureIncidentCaseTables(pool);
        const casesRes = await pool.query(
          `
          SELECT
            id,
            case_ref,
            status,
            priority,
            title,
            assigned_to_email,
            assigned_to_name,
            updated_at
          FROM alert_cases
          WHERE alert_id = $1
          ORDER BY updated_at DESC, id DESC
          LIMIT 20
          `,
          [id]
        );
        linkedCases = casesRes.rows.map(sanitizeCaseRow);
      } catch {}

      return res.json({
        ok: true,
        alert: {
          ...alert,
          metadata: asObject(alert.metadata),
          linked_cases: linkedCases,
        },
      });
    } catch (err) {
      console.error("[alerts] get error:", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch alert" });
    }
  });

  /* =========================
     RESOLVE ALERT
  ========================= */
  async function resolveAlertHandler(req, res) {
    try {
      const id = Number(req.params.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: "Invalid alert id" });
      }

      const existing = await pool.query(
        `
        SELECT id, store_id, status
        FROM alerts
        WHERE id = $1
        `,
        [id]
      );

      if (!existing.rowCount) {
        return res.status(404).json({ ok: false, error: "Alert not found" });
      }

      const row = existing.rows[0];
      if (!canAccessStore(req, row.store_id ? String(row.store_id) : null)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      if (String(row.status || "").toUpperCase() !== "OPEN") {
        return res.status(400).json({
          ok: false,
          error: "Alert not found or already resolved",
        });
      }

      const alertCols = await getAlertColumns();
      const firstDetectedExpr = optionalAlertColumnExpr(
        alertCols,
        null,
        "first_detected_at",
        "NULL::timestamptz",
        "first_detected_at"
      );
      const lastDetectedExpr = optionalAlertColumnExpr(
        alertCols,
        null,
        "last_detected_at",
        "NULL::timestamptz",
        "last_detected_at"
      );
      const resolvedAtExpr = optionalAlertColumnExpr(
        alertCols,
        null,
        "resolved_at",
        "NULL::timestamptz",
        "resolved_at"
      );
      const metadataExpr = optionalAlertColumnExpr(
        alertCols,
        null,
        "metadata",
        "'{}'::jsonb",
        "metadata"
      );
      const resolvedAtSetSql = alertCols.has("resolved_at") ? ", resolved_at = NOW()" : "";

      let r;
      try {
        r = await pool.query(
          `
          UPDATE alerts
          SET
            status = 'RESOLVED'
            ${resolvedAtSetSql}
          WHERE id = $1
          RETURNING
            id,
            type,
            entity_type,
            entity_id,
            store_id,
            severity,
            status,
            ${firstDetectedExpr},
            ${lastDetectedExpr},
            ${resolvedAtExpr},
            ${metadataExpr}
          `,
          [id]
        );
      } catch (err) {
        if (!isMissingUpdatedAtTriggerError(err)) {
          throw err;
        }
        await ensureAlertsUpdatedAtColumn(alertCols);
        alertColumnsCache = null;
        alertColumnsCacheTs = 0;
        r = await pool.query(
          `
          UPDATE alerts
          SET
            status = 'RESOLVED'
            ${resolvedAtSetSql}
          WHERE id = $1
          RETURNING
            id,
            type,
            entity_type,
            entity_id,
            store_id,
            severity,
            status,
            ${firstDetectedExpr},
            ${lastDetectedExpr},
            ${resolvedAtExpr},
            ${metadataExpr}
          `,
          [id]
        );
      }

      if (!r.rowCount) {
        return res.status(400).json({
          ok: false,
          error: "Alert not found or already resolved",
        });
      }

      try {
        await ensureIncidentCaseTables(pool);
        const actor = actorFromReq(req);
        const caseRows = await pool.query(
          `
          SELECT id
          FROM alert_cases
          WHERE alert_id = $1
            AND status IN ('OPEN', 'IN_PROGRESS')
          `,
          [id]
        );

        for (const c of caseRows.rows) {
          await pool.query(
            `
            INSERT INTO alert_case_events (
              case_id,
              event_type,
              note,
              actor_user_id,
              actor_email,
              payload
            )
            VALUES ($1, 'ALERT_RESOLVED', $2, $3, $4, $5::jsonb)
            `,
            [
              c.id,
              "Linked alert resolved",
              actor.user_id,
              actor.email,
              JSON.stringify({ alert_id: id }),
            ]
          );
        }
      } catch (e) {
        console.warn("[alerts/resolve] case timeline sync skipped:", e.message);
      }

      return res.json({
        ok: true,
        alert: {
          ...r.rows[0],
          metadata: asObject(r.rows[0]?.metadata),
        },
      });
    } catch (err) {
      console.error("[alerts] resolve error:", err);
      return res.status(500).json({ ok: false, error: "Failed to resolve alert" });
    }
  }

  router.put("/:id/resolve", resolveAlertHandler);
  router.post("/:id/resolve", resolveAlertHandler);

  return router;
};
