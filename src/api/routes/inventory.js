const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("./lib/catalogTable");
const {
  buildSessionId,
  durationSeconds,
  summarizeSession,
} = require("./lib/sessionSupport");
const {
  upsertOperationalAlert,
  resolveOperationalAlert,
} = require("./lib/operationalAlerts");

function createSessionRef(prefix) {
  return `${String(prefix || "SESSION").toUpperCase()}-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeTag(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeTag).filter(Boolean)));
  }

  return Array.from(
    new Set(
      String(value || "")
        .split(/\r?\n|,/)
        .map(normalizeTag)
        .filter(Boolean)
    )
  );
}

function operatorContext(req) {
  const email = String(req.user?.email || "").trim().toLowerCase() || null;
  return {
    user_id: Number(req.user?.user_id) || null,
    email,
    label: email || "system",
  };
}

module.exports = function buildInventoryRoutes(pool) {
  const router = express.Router();
  const STOCK_AUDIT_PRODUCT_KEY = "stock_audit";
  const STOCK_AUDIT_READ_PERMISSIONS = [
    "dashboard.view_stock_audit",
    "dashboard.manage_stock_audit",
    "handheld.inventory_count",
    "handheld.run_audits",
  ];
  const STOCK_AUDIT_WRITE_PERMISSIONS = [
    "dashboard.manage_stock_audit",
    "handheld.inventory_count",
    "handheld.run_audits",
  ];

  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      next();
    } catch (err) {
      console.error("JWT error:", err.message);
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function normalizedRoles(req) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    return roles.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean);
  }

  function canAccessStore(req, storeId) {
    const roles = normalizedRoles(req);
    const allowedStores = Array.isArray(req.user?.store_ids) ? req.user.store_ids : [];

    if (roles.includes("MASTER_ADMIN") || roles.includes("ADMIN") || roles.includes("GLOBAL_ADMIN")) {
      return true;
    }

    return !!storeId && allowedStores.includes(storeId);
  }

  function isAdminUser(req) {
    const roles = normalizedRoles(req);
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function normalizedProductKey(req) {
    return String(req.user?.product_key || "").trim().toLowerCase();
  }

  function permissionAliases(permission) {
    switch (String(permission || "").trim()) {
      case "dashboard.view_stock_audit":
        return ["dashboard.view_stock_audit", "dashboard.view_inventory", "dashboard.inventory"];
      case "dashboard.manage_stock_audit":
        return ["dashboard.manage_stock_audit"];
      case "handheld.inventory_count":
        return ["handheld.inventory_count", "handheld.inventory"];
      case "handheld.run_audits":
        return ["handheld.run_audits", "handheld.audit"];
      default:
        return [];
    }
  }

  function hasPermission(req, permission) {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    if (permissions.includes("*")) return true;
    if (permissions.includes(permission)) return true;
    return permissionAliases(permission).some((alias) => permissions.includes(alias));
  }

  function requireStockAuditProduct(req, res, next) {
    if (normalizedProductKey(req) === STOCK_AUDIT_PRODUCT_KEY) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      error: "Xandora Stock Audit access required",
    });
  }

  function requireAnyPermission(requiredPermissions) {
    return (req, res, next) => {
      if (isAdminUser(req)) {
        return next();
      }

      const allowed = requiredPermissions.some((permission) =>
        hasPermission(req, permission)
      );

      if (allowed) {
        return next();
      }

      return res.status(403).json({
        ok: false,
        error: "Stock Audit permission required",
      });
    };
  }

  router.use(authenticate);
  router.use(requireStockAuditProduct);
  router.use(requireAnyPermission(STOCK_AUDIT_READ_PERMISSIONS));

  async function getActiveSession(storeId) {
    const result = await pool.query(
      `
      SELECT *
      FROM inventory_sessions
      WHERE store_id = $1
        AND status = 'ACTIVE'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [storeId]
    );

    return result.rows[0] || null;
  }

  async function computeSessionMetrics(db, sessionId) {
    const result = await db.query(
      `
      SELECT
        COUNT(DISTINCT epc)::int AS unique_epcs,
        COALESCE(SUM(read_count), 0)::int AS total_reads,
        MIN(created_at) AS first_scan_at,
        MAX(last_seen) AS last_scan_at
      FROM inventory_scans
      WHERE session_id = $1
      `,
      [sessionId]
    );

    return result.rows[0] || {
      unique_epcs: 0,
      total_reads: 0,
      first_scan_at: null,
      last_scan_at: null,
    };
  }

  function toInventorySummary(row, metrics = {}) {
    const expected = toInt(row.total_expected);
    const found = toInt(
      metrics.unique_epcs != null ? metrics.unique_epcs : row.total_found
    );
    const missing = Math.max(expected - found, 0);
    const seconds = toInt(
      row.duration_seconds || durationSeconds(row.started_at, row.ended_at)
    );
    const accuracy = expected > 0 ? Number(((found / expected) * 100).toFixed(2)) : 0;
    const totalReads = toInt(metrics.total_reads);
    const summaryPayload = {
      expected_count: expected,
      found_count: found,
      missing_count: missing,
      total_reads: totalReads,
      read_rate: seconds > 0 ? Number((totalReads / seconds).toFixed(2)) : 0,
      first_scan_at: metrics.first_scan_at || null,
      last_scan_at: metrics.last_scan_at || null,
      session_duration_seconds: seconds,
    };

    return {
      ...summarizeSession("AUD", row, {
        duration_seconds: seconds,
        total_reads: totalReads,
        metrics_summary: summaryPayload,
      }),
      status: row.status === "ENDED" ? "COMPLETED" : summarizeSession("AUD", row).status,
      total_expected: expected,
      total_found: found,
      total_missing: missing,
      accuracy_percent: accuracy,
      metrics_summary: summaryPayload,
    };
  }

  async function loadInventorySessionSummary(db, sessionRow, { persist = false, finalize = false } = {}) {
    if (!sessionRow) return null;

    const metrics = await computeSessionMetrics(db, sessionRow.id);
    const summary = toInventorySummary(sessionRow, metrics);

    if (!persist) {
      return summary;
    }

    const nextStatus = finalize ? "COMPLETED" : sessionRow.status;
    const update = await db.query(
      `
      UPDATE inventory_sessions
      SET
        status = $2,
        ended_at = CASE
          WHEN $2 = 'COMPLETED' AND ended_at IS NULL THEN NOW()
          ELSE ended_at
        END,
        total_found = $3,
        total_missing = $4,
        accuracy_percent = $5,
        duration_seconds = $6,
        metrics_summary = $7::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        sessionRow.id,
        nextStatus,
        summary.total_found,
        summary.total_missing,
        summary.accuracy_percent,
        summary.duration_seconds,
        JSON.stringify(summary.metrics_summary),
      ]
    );

    return toInventorySummary(update.rows[0] || sessionRow, metrics);
  }

  async function enforceStore(req, res) {
    const storeId = String(req.query.store_id || req.body?.store_id || "").trim();
    if (!storeId) {
      res.status(400).json({ ok: false, error: "store_id required" });
      return null;
    }

    if (!canAccessStore(req, storeId)) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return null;
    }

    return storeId;
  }

  router.post("/start", requireAnyPermission(STOCK_AUDIT_WRITE_PERMISSIONS), async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const existing = await getActiveSession(storeId);
      if (existing) {
        const summary = await loadInventorySessionSummary(pool, existing);
        return res.json({ ok: true, session: summary });
      }

      const expectedCount = toInt(req.body?.total_expected);
      const deviceId = String(req.body?.device_id || "").trim() || null;
      const operator = operatorContext(req);
      const sessionRef = createSessionRef("AUD");

      const inserted = await pool.query(
        `
        INSERT INTO inventory_sessions (
          session_id,
          session_type,
          store_id,
          device_id,
          status,
          started_at,
          total_expected,
          total_found,
          total_missing,
          accuracy_percent,
          duration_seconds,
          created_by_user_id,
          created_by_email,
          operator_label,
          metrics_summary
        )
        VALUES (
          $1,
          'AUDIT',
          $2,
          $3,
          'ACTIVE',
          NOW(),
          $4,
          0,
          $4,
          0,
          0,
          $5,
          $6,
          $7,
          '{}'::jsonb
        )
        RETURNING *
        `,
        [
          sessionRef,
          storeId,
          deviceId,
          expectedCount,
          operator.user_id,
          operator.email,
          operator.label,
        ]
      );

      const session = await loadInventorySessionSummary(pool, inserted.rows[0]);
      return res.json({ ok: true, session });
    } catch (err) {
      console.error("[inventory/start]", err);
      return res.status(500).json({ ok: false, error: "Failed to start session" });
    }
  });

  router.post("/scan", requireAnyPermission(STOCK_AUDIT_WRITE_PERMISSIONS), async (req, res) => {
    const client = await pool.connect();
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const epcs = normalizeTagList(req.body?.epcs || req.body?.epc);
      const deviceId = String(req.body?.device_id || "").trim() || null;

      if (!epcs.length) {
        return res.status(400).json({ ok: false, error: "At least one EPC is required" });
      }

      await client.query("BEGIN");

      const session = await getActiveSession(storeId);
      if (!session) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "No active stock audit session",
        });
      }

      const operator = operatorContext(req);
      const seenAt = new Date().toISOString();
      const inserted = [];

      for (const epc of epcs) {
        const upsert = await client.query(
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
          VALUES ($1, $2, 1, $3, $4::timestamptz, $5, $6::jsonb)
          ON CONFLICT (session_id, epc)
          DO UPDATE SET
            read_count = inventory_scans.read_count + 1,
            device_id = COALESCE(EXCLUDED.device_id, inventory_scans.device_id),
            last_seen = GREATEST(inventory_scans.last_seen, EXCLUDED.last_seen),
            store_id = COALESCE(EXCLUDED.store_id, inventory_scans.store_id),
            metadata = COALESCE(inventory_scans.metadata, '{}'::jsonb) || EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING epc, read_count, last_seen
          `,
          [
            session.id,
            epc,
            deviceId,
            seenAt,
            storeId,
            JSON.stringify({
              source: "HANDHELD",
              scanned_at: seenAt,
              operator: operator.email,
              device_id: deviceId,
            }),
          ]
        );

        if (upsert.rows[0]) {
          inserted.push(upsert.rows[0]);
        }
      }

      const summary = await loadInventorySessionSummary(client, session, {
        persist: true,
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        scanned_count: inserted.length,
        session: summary,
        scans: inserted,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[inventory/scan]", err);
      return res.status(500).json({ ok: false, error: "Failed to capture stock audit scans" });
    } finally {
      client.release();
    }
  });

  router.post("/end", requireAnyPermission(STOCK_AUDIT_WRITE_PERMISSIONS), async (req, res) => {
    const client = await pool.connect();
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      await client.query("BEGIN");
      const session = await getActiveSession(storeId);
      if (!session) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "No active session" });
      }

      const summary = await loadInventorySessionSummary(client, session, {
        persist: true,
        finalize: true,
      });

      if (summary.total_missing > 0) {
        await upsertOperationalAlert(client, {
          type: "MISSING_EXPECTED_ITEMS",
          entity_type: "INVENTORY_SESSION",
          entity_id: summary.session_id,
          store_id: storeId,
          severity: summary.total_missing >= 10 ? 75 : 55,
          metadata: {
            session_id: summary.session_id,
            missing_count: summary.total_missing,
            expected_count: summary.total_expected,
            found_count: summary.total_found,
            operator: summary.operator_label || summary.created_by_email || null,
          },
        });
      } else {
        await resolveOperationalAlert(client, {
          type: "MISSING_EXPECTED_ITEMS",
          entity_type: "INVENTORY_SESSION",
          entity_id: summary.session_id,
          store_id: storeId,
          metadata: {
            resolved_reason: "session_completed_without_missing_items",
          },
        });
      }

      await client.query("COMMIT");
      return res.json({ ok: true, session: summary });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[inventory/end]", err);
      return res.status(500).json({ ok: false, error: "Failed to end session" });
    } finally {
      client.release();
    }
  });

  router.get("/progress", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const session = await getActiveSession(storeId);
      if (!session) {
        return res.json({
          ok: true,
          active: false,
          found: 0,
          expected: 0,
          missing: 0,
          accuracy: 0,
          reads: 0,
          duration_seconds: 0,
          read_rate: 0,
          session: null,
        });
      }

      const summary = await loadInventorySessionSummary(pool, session);
      return res.json({
        ok: true,
        active: true,
        found: summary.total_found,
        expected: summary.total_expected,
        missing: summary.total_missing,
        accuracy: summary.accuracy_percent,
        reads: summary.total_reads,
        duration_seconds: summary.duration_seconds,
        read_rate: summary.read_rate,
        session: summary,
      });
    } catch (err) {
      console.error("[inventory/progress]", err);
      return res.status(500).json({ ok: false, error: "Failed to load progress" });
    }
  });

  router.get("/active", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const session = await getActiveSession(storeId);
      const summary = session ? await loadInventorySessionSummary(pool, session) : null;
      return res.json({ ok: true, session: summary });
    } catch (err) {
      console.error("[inventory/active]", err);
      return res.status(500).json({ ok: false, error: "Failed to load active session" });
    }
  });

  router.get("/history", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const result = await pool.query(
        `
        SELECT
          s.*,
          COUNT(DISTINCT sc.epc)::int AS total_found_live,
          COALESCE(SUM(sc.read_count), 0)::int AS total_reads_live,
          MAX(sc.last_seen) AS last_scan_at
        FROM inventory_sessions s
        LEFT JOIN inventory_scans sc ON sc.session_id = s.id
        WHERE s.store_id = $1
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT 50
        `,
        [storeId]
      );

      const sessions = result.rows.map((row) =>
        toInventorySummary(row, {
          unique_epcs: row.total_found_live,
          total_reads: row.total_reads_live,
          last_scan_at: row.last_scan_at,
        })
      );

      return res.json({ ok: true, sessions });
    } catch (err) {
      console.error("[inventory/history]", err);
      return res.status(500).json({ ok: false, error: "Failed to load history" });
    }
  });

  router.get("/items", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      let includeCatalog = true;
      try {
        await ensureCatalogTable(pool);
      } catch {
        includeCatalog = false;
      }

      const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
      let sessionId = req.query.session_id ? Number(req.query.session_id) : null;

      if (!sessionId) {
        const active = await getActiveSession(storeId);
        if (active) {
          sessionId = Number(active.id);
        }
      }

      if (!sessionId) {
        const recent = includeCatalog
          ? await pool.query(
              `
              SELECT
                s.tag AS epc,
                COALESCE(SUM(s.read_count), 0)::int AS read_count,
                MAX(COALESCE(s.last_seen, s.ts)) AS last_seen,
                MAX(COALESCE(s.first_seen, s.ts)) AS first_seen,
                c.sku,
                c.product_name,
                c.brand,
                c.category,
                c.size_label,
                c.color,
                c.price_lkr
              FROM scan_items s
              LEFT JOIN catalog_items c
                ON c.store_id = $1
               AND c.epc = s.tag
              WHERE s.store_id = $1
                AND COALESCE(s.last_seen, s.ts) >= NOW() - INTERVAL '24 hours'
              GROUP BY
                s.tag,
                c.sku,
                c.product_name,
                c.brand,
                c.category,
                c.size_label,
                c.color,
                c.price_lkr
              ORDER BY MAX(COALESCE(s.last_seen, s.ts)) DESC
              LIMIT $2
              `,
              [storeId, limit]
            )
          : await pool.query(
              `
              SELECT
                s.tag AS epc,
                COALESCE(SUM(s.read_count), 0)::int AS read_count,
                MAX(COALESCE(s.last_seen, s.ts)) AS last_seen,
                MAX(COALESCE(s.first_seen, s.ts)) AS first_seen
              FROM scan_items s
              WHERE s.store_id = $1
                AND COALESCE(s.last_seen, s.ts) >= NOW() - INTERVAL '24 hours'
              GROUP BY s.tag
              ORDER BY MAX(COALESCE(s.last_seen, s.ts)) DESC
              LIMIT $2
              `,
              [storeId, limit]
            );

        return res.json({
          ok: true,
          session_id: null,
          source: "recent_scans",
          count: recent.rowCount,
          items: recent.rows,
        });
      }

      const result = includeCatalog
        ? await pool.query(
            `
            SELECT
              sc.epc,
              sc.read_count,
              sc.last_seen,
              c.sku,
              c.product_name,
              c.brand,
              c.category,
              c.size_label,
              c.color,
              c.price_lkr
            FROM inventory_scans sc
            LEFT JOIN catalog_items c
              ON c.store_id = $2
             AND c.epc = sc.epc
            WHERE sc.session_id = $1
            ORDER BY sc.read_count DESC, sc.last_seen DESC, sc.epc ASC
            LIMIT $3
            `,
            [sessionId, storeId, limit]
          )
        : await pool.query(
            `
            SELECT epc, read_count, last_seen
            FROM inventory_scans
            WHERE session_id = $1
            ORDER BY read_count DESC, last_seen DESC, epc ASC
            LIMIT $2
            `,
            [sessionId, limit]
          );

      return res.json({
        ok: true,
        session_id: sessionId,
        source: "active_session",
        count: result.rowCount,
        items: result.rows,
      });
    } catch (err) {
      console.error("[inventory/items]", err);
      return res.status(500).json({ ok: false, error: "Failed to load inventory items" });
    }
  });

  router.get("/kpis", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const result = await pool.query(
        `
        SELECT
          COUNT(*)::int AS sessions_total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS sessions_active,
          COALESCE(AVG(accuracy_percent), 0)::numeric AS avg_accuracy_percent,
          COALESCE(SUM((metrics_summary->>'total_reads')::int), 0)::int AS total_reads,
          (
            SELECT COUNT(DISTINCT epc)::int
            FROM inventory_scans sc
            JOIN inventory_sessions s2 ON s2.id = sc.session_id
            WHERE s2.store_id = $1
          ) AS unique_epcs_total
        FROM inventory_sessions
        WHERE store_id = $1
        `,
        [storeId]
      );

      return res.json({ ok: true, kpis: result.rows[0] || {} });
    } catch (err) {
      console.error("[inventory/kpis]", err);
      return res.status(500).json({ ok: false, error: "Failed to load KPIs" });
    }
  });

  router.post("/reset", async (req, res) => {
    const storeId = req.body?.store_id ? String(req.body.store_id) : null;

    if (!isAdminUser(req)) {
      return res.status(403).json({ ok: false, error: "Admin required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let deletedScans = 0;
      let deletedSessions = 0;

      if (storeId) {
        const delScans = await client.query(
          `
          DELETE FROM inventory_scans sc
          USING inventory_sessions s
          WHERE sc.session_id = s.id
            AND s.store_id = $1
          `,
          [storeId]
        );
        deletedScans = delScans.rowCount || 0;

        const delSessions = await client.query(
          `
          DELETE FROM inventory_sessions
          WHERE store_id = $1
          `,
          [storeId]
        );
        deletedSessions = delSessions.rowCount || 0;
      } else {
        const delScans = await client.query(`DELETE FROM inventory_scans`);
        deletedScans = delScans.rowCount || 0;

        const delSessions = await client.query(`DELETE FROM inventory_sessions`);
        deletedSessions = delSessions.rowCount || 0;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        store_id: storeId,
        deleted_inventory_scans: deletedScans,
        deleted_inventory_sessions: deletedSessions,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[inventory/reset]", err);
      return res.status(500).json({ ok: false, error: "Failed to reset inventory" });
    } finally {
      client.release();
    }
  });

  return router;
};
