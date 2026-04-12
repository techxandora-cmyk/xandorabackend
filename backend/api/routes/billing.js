const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("../../../src/api/routes/lib/catalogTable");
const {
  buildSessionId,
  summarizeSession,
  durationSeconds,
} = require("../../../src/api/routes/lib/sessionSupport");
const {
  upsertOperationalAlert,
} = require("../../../src/api/routes/lib/operationalAlerts");
const {
  validateRetailScan,
  getNetSoldCount,
} = require("../../../src/api/routes/lib/retailValidation");

function createSessionRef(prefix) {
  return `${String(prefix || "SESSION").toUpperCase()}-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function operatorContext(req) {
  const email = String(req.user?.email || "").trim().toLowerCase() || null;
  return {
    user_id: Number(req.user?.user_id) || null,
    email,
    label: email || "system",
  };
}

module.exports = function buildBillingRoutes(pool) {
  const router = express.Router();

  function normalizedRoles(req) {
    const roleList = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const singleRole = req.user?.role ? [req.user.role] : [];
    return Array.from(
      new Set(
        [...roleList, ...singleRole]
          .map((r) => String(r || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }

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

  router.use(authenticate);

  function isAdminUser(req) {
    const roles = normalizedRoles(req);
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function canAccessStore(req, storeId) {
    if (!storeId) return false;
    if (isAdminUser(req)) return true;

    const allowedStores = Array.isArray(req.user?.store_ids) ? req.user.store_ids : [];
    return allowedStores.includes(storeId);
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

  async function getActiveSession(storeId) {
    const result = await pool.query(
      `
      SELECT *
      FROM billing_sessions
      WHERE store_id = $1
        AND status = 'ACTIVE'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [storeId]
    );

    return result.rows[0] || null;
  }

  async function computeBillingMetrics(db, sessionId) {
    const result = await db.query(
      `
      SELECT
        COUNT(*)::int AS unique_epcs,
        COALESCE(SUM(read_count), 0)::int AS total_reads,
        COUNT(*) FILTER (WHERE validation_status = 'MATCHED')::int AS matched_count,
        COUNT(*) FILTER (WHERE validation_status = 'UNKNOWN_EPC')::int AS unknown_count,
        COUNT(*) FILTER (WHERE validation_status = 'ALREADY_BILLED')::int AS already_billed_count,
        COUNT(*) FILTER (WHERE validation_status = 'DUPLICATE')::int AS duplicate_count,
        COUNT(*) FILTER (WHERE validation_status = 'VALIDATION_FAILED')::int AS validation_failed_count,
        MIN(first_seen) AS first_scan_at,
        MAX(last_seen) AS last_scan_at
      FROM billing_session_scans
      WHERE session_id = $1
      `,
      [sessionId]
    );

    return result.rows[0] || {
      unique_epcs: 0,
      total_reads: 0,
      matched_count: 0,
      unknown_count: 0,
      already_billed_count: 0,
      duplicate_count: 0,
      validation_failed_count: 0,
      first_scan_at: null,
      last_scan_at: null,
    };
  }

  function toBillingSummary(row, metrics = {}) {
    const expected = toInt(row.expected_items_count);
    const uniqueEpcs = toInt(metrics.unique_epcs != null ? metrics.unique_epcs : row.scanned_items_count);
    const matched = toInt(metrics.matched_count);
    const missing = Math.max(expected - matched, 0);
    const seconds = toInt(row.duration_seconds || durationSeconds(row.started_at, row.ended_at));
    const totalReads = toInt(metrics.total_reads);
    const accuracy = expected > 0 ? Number(((matched / expected) * 100).toFixed(2)) : 0;
    const summaryPayload = {
      expected_items_count: expected,
      scanned_items_count: uniqueEpcs,
      matched_items_count: matched,
      missing_items_count: missing,
      total_reads: totalReads,
      duplicate_count: toInt(metrics.duplicate_count),
      unknown_count: toInt(metrics.unknown_count),
      already_billed_count: toInt(metrics.already_billed_count),
      validation_failed_count: toInt(metrics.validation_failed_count),
      read_rate: seconds > 0 ? Number((totalReads / seconds).toFixed(2)) : 0,
      first_scan_at: metrics.first_scan_at || null,
      last_scan_at: metrics.last_scan_at || null,
      session_duration_seconds: seconds,
    };

    return {
      ...summarizeSession("BILL", row, {
        duration_seconds: seconds,
        total_reads: totalReads,
        metrics_summary: summaryPayload,
      }),
      expected_items_count: expected,
      scanned_items_count: uniqueEpcs,
      matched_items_count: matched,
      missing_items_count: missing,
      accuracy_percent: accuracy,
      metrics_summary: summaryPayload,
    };
  }

  async function loadBillingSessionSummary(db, sessionRow, { persist = false, statusOverride = null } = {}) {
    if (!sessionRow) return null;

    const metrics = await computeBillingMetrics(db, sessionRow.id);
    const summary = toBillingSummary(sessionRow, metrics);

    if (!persist) {
      return summary;
    }

    const nextStatus = statusOverride || sessionRow.status;
    const update = await db.query(
      `
      UPDATE billing_sessions
      SET
        status = $2,
        ended_at = CASE
          WHEN $2 IN ('COMPLETED', 'CANCELLED') AND ended_at IS NULL THEN NOW()
          ELSE ended_at
        END,
        scanned_items_count = $3,
        metrics_summary = $4::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        sessionRow.id,
        nextStatus,
        summary.scanned_items_count,
        JSON.stringify(summary.metrics_summary),
      ]
    );

    return toBillingSummary(update.rows[0] || sessionRow, metrics);
  }

  async function trackValidationAlert(db, storeId, validation, scanPayload = {}) {
    const typeByStatus = {
      UNKNOWN_EPC: "UNKNOWN_EPC_DETECTED",
      ALREADY_BILLED: "ITEM_ALREADY_BILLED",
      VALIDATION_FAILED: "VALIDATION_SERVICE_UNAVAILABLE",
      DUPLICATE: "DUPLICATE_SCAN_BEHAVIOR",
    };

    const alertType = typeByStatus[validation.validation_status];
    if (!alertType) return null;

    const severityByStatus = {
      UNKNOWN_EPC: 55,
      ALREADY_BILLED: 80,
      VALIDATION_FAILED: 70,
      DUPLICATE: 35,
    };

    return upsertOperationalAlert(db, {
      type: alertType,
      entity_type: "BILLING_SCAN",
      entity_id: `${storeId}:${scanPayload.epc}`,
      store_id: storeId,
      severity: severityByStatus[validation.validation_status] || 50,
      metadata: {
        epc: scanPayload.epc,
        device_id: scanPayload.device_id || null,
        validation_status: validation.validation_status,
        validation_message: validation.validation_message,
        session_id: scanPayload.session_id || null,
      },
    });
  }

  async function buildScanRows(db, storeId, session) {
    await ensureCatalogTable(db);

    if (!session) {
      const recent = await db.query(
        `
        SELECT
          s.tag AS epc,
          COALESCE(SUM(s.read_count), 0)::int AS read_count,
          MAX(s.device_id) AS device_id,
          MIN(COALESCE(s.first_seen, s.ts)) AS first_seen,
          MAX(COALESCE(s.last_seen, s.ts)) AS last_seen,
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
        LIMIT 200
        `,
        [storeId]
      );

      const rows = [];
      for (const row of recent.rows) {
        const validation = await validateRetailScan(db, {
          store_id: storeId,
          epc: row.epc,
        });
        rows.push({
          ...row,
          validation_status: validation.validation_status,
          validation_label: validation.validation_label,
          validation_message: validation.validation_message,
        });
      }

      return {
        source: "recent_scans",
        rows,
      };
    }

    const result = await db.query(
      `
      SELECT
        b.epc,
        b.read_count,
        b.device_id,
        b.first_seen,
        b.last_seen,
        b.validation_status,
        b.validation_message,
        b.sku,
        b.product_name,
        b.price_lkr,
        c.brand,
        c.category,
        c.size_label,
        c.color
      FROM billing_session_scans b
      LEFT JOIN catalog_items c
        ON c.store_id = $2
       AND c.epc = b.epc
      WHERE b.session_id = $1
      ORDER BY b.last_seen DESC
      `,
      [session.id, storeId]
    );

    return {
      source: "active_session",
      rows: result.rows.map((row) => ({
        ...row,
        validation_label: row.validation_status
          ? row.validation_status
              .replaceAll("_", " ")
              .toLowerCase()
              .replace(/\b\w/g, (char) => char.toUpperCase())
          : "Validation failed",
      })),
    };
  }

  router.post("/start", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const existing = await getActiveSession(storeId);
      if (existing) {
        const summary = await loadBillingSessionSummary(pool, existing);
        return res.json({ ok: true, session: summary });
      }

      const expectedItems = toInt(req.body?.expected_items_count);
      const deviceId = String(req.body?.device_id || req.body?.pos_terminal_id || "").trim() || null;
      const operator = operatorContext(req);
      const inserted = await pool.query(
        `
        INSERT INTO billing_sessions (
          session_id,
          session_type,
          store_id,
          device_id,
          status,
          expected_items_count,
          scanned_items_count,
          created_by_user_id,
          created_by_email,
          operator_label,
          metrics_summary
        )
        VALUES ($1, 'BILLING', $2, $3, 'ACTIVE', $4, 0, $5, $6, $7, '{}'::jsonb)
        RETURNING *
        `,
        [
          createSessionRef("BILL"),
          storeId,
          deviceId,
          expectedItems,
          operator.user_id,
          operator.email,
          operator.label,
        ]
      );

      const session = await loadBillingSessionSummary(pool, inserted.rows[0]);
      return res.json({ ok: true, session });
    } catch (err) {
      console.error("[billing/start]", err);
      return res.status(500).json({ ok: false, error: "Start failed" });
    }
  });

  router.get("/active", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const session = await getActiveSession(storeId);
      const summary = session ? await loadBillingSessionSummary(pool, session) : null;
      return res.json({ ok: true, session: summary });
    } catch (err) {
      console.error("[billing/active]", err);
      return res.status(500).json({ ok: false, error: "Failed to load active session" });
    }
  });

  router.post("/complete", async (req, res) => {
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

      const summary = await loadBillingSessionSummary(client, session, {
        persist: true,
        statusOverride: "COMPLETED",
      });

      await client.query("COMMIT");
      return res.json({ ok: true, session: summary });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[billing/complete]", err);
      return res.status(500).json({ ok: false, error: "Complete failed" });
    } finally {
      client.release();
    }
  });

  router.post("/cancel", async (req, res) => {
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

      const summary = await loadBillingSessionSummary(client, session, {
        persist: true,
        statusOverride: "CANCELLED",
      });

      await client.query("COMMIT");
      return res.json({ ok: true, session: summary });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[billing/cancel]", err);
      return res.status(500).json({ ok: false, error: "Cancel failed" });
    } finally {
      client.release();
    }
  });

  router.post("/scan", async (req, res) => {
    const client = await pool.connect();
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const epc = String(req.body?.epc || "").trim().toUpperCase();
      const deviceId = String(req.body?.device_id || "UI_MANUAL").trim() || "UI_MANUAL";

      if (!epc) {
        return res.status(400).json({ ok: false, error: "store_id + epc required" });
      }

      await client.query("BEGIN");
      await ensureCatalogTable(client);

      const session = await getActiveSession(storeId);
      if (!session) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "No active session" });
      }

      const existing = await client.query(
        `
        SELECT read_count
        FROM billing_session_scans
        WHERE session_id = $1
          AND epc = $2
        LIMIT 1
        `,
        [session.id, epc]
      );
      const duplicateReadCount = Number(existing.rows[0]?.read_count || 0);

      const validation = await validateRetailScan(client, {
        store_id: storeId,
        epc,
        duplicate_read_count: duplicateReadCount,
      });

      await client.query(
        `
        INSERT INTO billing_session_scans (
          session_id,
          epc,
          device_id,
          read_count,
          validation_status,
          validation_message,
          sku,
          product_name,
          price_lkr,
          metadata,
          last_validation_at
        )
        VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9::jsonb, NOW())
        ON CONFLICT (session_id, epc)
        DO UPDATE SET
          read_count = billing_session_scans.read_count + 1,
          device_id = COALESCE(EXCLUDED.device_id, billing_session_scans.device_id),
          last_seen = NOW(),
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
          session.id,
          epc,
          deviceId,
          validation.validation_status,
          validation.validation_message,
          validation.catalog_item?.sku || null,
          validation.catalog_item?.product_name || null,
          validation.catalog_item?.price_lkr || null,
          JSON.stringify({
            validation_label: validation.validation_label,
            already_billed: validation.already_billed,
          }),
        ]
      );

      await trackValidationAlert(client, storeId, validation, {
        epc,
        device_id: deviceId,
        session_id: buildSessionId("BILL", session),
      });

      const summary = await loadBillingSessionSummary(client, session, { persist: true });
      const scanRow = await client.query(
        `
        SELECT *
        FROM billing_session_scans
        WHERE session_id = $1
          AND epc = $2
        LIMIT 1
        `,
        [session.id, epc]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        validation,
        session: summary,
        scan: scanRow.rows[0] || null,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[billing/scan]", err);
      return res.status(500).json({ ok: false, error: "Scan failed" });
    } finally {
      client.release();
    }
  });

  router.get("/scans", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const session = await getActiveSession(storeId);
      const scanData = await buildScanRows(pool, storeId, session);
      const summary = session ? await loadBillingSessionSummary(pool, session) : null;

      return res.json({
        ok: true,
        session: summary,
        scans: scanData.rows,
        source: scanData.source,
      });
    } catch (err) {
      console.error("[billing/scans]", err);
      return res.status(500).json({ ok: false, error: "Failed to load scans" });
    }
  });

  router.get("/sessions", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
      const result = await pool.query(
        `
        SELECT
          s.*,
          COUNT(*)::int AS unique_epcs,
          COALESCE(SUM(b.read_count), 0)::int AS total_reads,
          COUNT(*) FILTER (WHERE b.validation_status = 'MATCHED')::int AS matched_count,
          COUNT(*) FILTER (WHERE b.validation_status = 'UNKNOWN_EPC')::int AS unknown_count,
          COUNT(*) FILTER (WHERE b.validation_status = 'ALREADY_BILLED')::int AS already_billed_count,
          COUNT(*) FILTER (WHERE b.validation_status = 'DUPLICATE')::int AS duplicate_count,
          COUNT(*) FILTER (WHERE b.validation_status = 'VALIDATION_FAILED')::int AS validation_failed_count,
          MIN(b.first_seen) AS first_scan_at,
          MAX(b.last_seen) AS last_scan_at
        FROM billing_sessions s
        LEFT JOIN billing_session_scans b ON b.session_id = s.id
        WHERE s.store_id = $1
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT $2
        `,
        [storeId, limit]
      );

      return res.json({
        ok: true,
        sessions: result.rows.map((row) => toBillingSummary(row, row)),
      });
    } catch (err) {
      console.error("[billing/sessions]", err);
      return res.status(500).json({ ok: false, error: "Failed to load session history" });
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const storeId = await enforceStore(req, res);
      if (!storeId) return;

      const session = await getActiveSession(storeId);
      if (!session) {
        return res.json({
          ok: true,
          session: null,
          summary: {
            expected_items_count: 0,
            scanned_items_count: 0,
            matched_items_count: 0,
            missing_items_count: 0,
            accuracy_percent: 0,
            total_reads: 0,
            duplicate_count: 0,
            unknown_count: 0,
            already_billed_count: 0,
            validation_failed_count: 0,
            duration_seconds: 0,
            read_rate: 0,
          },
        });
      }

      const summary = await loadBillingSessionSummary(pool, session);
      return res.json({
        ok: true,
        session: summary,
        summary: {
          expected_items_count: summary.expected_items_count,
          scanned_items_count: summary.scanned_items_count,
          matched_items_count: summary.matched_items_count,
          missing_items_count: summary.missing_items_count,
          accuracy_percent: summary.accuracy_percent,
          total_reads: summary.total_reads,
          duplicate_count: summary.metrics_summary.duplicate_count,
          unknown_count: summary.metrics_summary.unknown_count,
          already_billed_count: summary.metrics_summary.already_billed_count,
          validation_failed_count: summary.metrics_summary.validation_failed_count,
          duration_seconds: summary.duration_seconds,
          read_rate: summary.read_rate,
        },
      });
    } catch (err) {
      console.error("[billing/summary]", err);
      return res.status(500).json({ ok: false, error: "Failed to load summary" });
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
          DELETE FROM billing_session_scans bss
          USING billing_sessions bs
          WHERE bss.session_id = bs.id
            AND bs.store_id = $1
          `,
          [storeId]
        );
        deletedScans = delScans.rowCount || 0;

        const delSessions = await client.query(
          `
          DELETE FROM billing_sessions
          WHERE store_id = $1
          `,
          [storeId]
        );
        deletedSessions = delSessions.rowCount || 0;
      } else {
        const delScans = await client.query(`DELETE FROM billing_session_scans`);
        deletedScans = delScans.rowCount || 0;

        const delSessions = await client.query(`DELETE FROM billing_sessions`);
        deletedSessions = delSessions.rowCount || 0;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        store_id: storeId,
        deleted_billing_scans: deletedScans,
        deleted_billing_sessions: deletedSessions,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[billing/reset]", err);
      return res.status(500).json({ ok: false, error: "Failed to reset billing" });
    } finally {
      client.release();
    }
  });

  return router;
};
