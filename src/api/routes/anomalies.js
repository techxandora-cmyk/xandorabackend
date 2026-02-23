// src/api/routes/anomalies.js
const express = require("express");
const jwt = require("jsonwebtoken");

module.exports = function buildAnomalyRoutes(pool) {
  const router = express.Router();
  const ANOMALY_STATUSES = new Set(["open", "ack", "resolved"]);

  function normalizeRuleCode(value) {
    return String(value || "MANUAL")
      .trim()
      .toUpperCase();
  }

  function normalizeStatus(value) {
    const normalized = String(value || "open")
      .trim()
      .toLowerCase();
    return ANOMALY_STATUSES.has(normalized) ? normalized : null;
  }

  function normalizeDetails(value) {
    if (value === undefined || value === null) {
      return {};
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    return null;
  }

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

  function requireAdminWrite(req, res, next) {
    const method = String(req.method || "GET").toUpperCase();
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (!isWrite) return next();

    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const isAdmin =
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN") ||
      req.user?.role === "ADMIN" ||
      req.user?.role === "GLOBAL_ADMIN";

    if (!isAdmin) {
      return res.status(403).json({
        ok: false,
        error: "Read-only access. Admin required for changes.",
      });
    }

    return next();
  }

  router.use(authenticate);
  router.use(requireAdminWrite);

  /* =========================
     GET /api/v1/anomalies
     List anomalies (DB = anomalies table)
  ========================= */
  router.get("/", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const result = await pool.query(
        `
        SELECT
          id,
          rule_code,
          tag,
          device_id,
          antenna_role,
          details,
          status,
          created_at,
          resolved_at
        FROM anomalies
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );

      return res.json({
        ok: true,
        count: result.rowCount,
        anomalies: result.rows,
      });
    } catch (err) {
      console.error("[anomalies] GET / error:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch anomalies",
      });
    }
  });

  /* =========================
     GET /api/v1/anomalies/:id
     Get single anomaly
  ========================= */
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        SELECT
          id,
          rule_code,
          tag,
          device_id,
          antenna_role,
          details,
          status,
          created_at,
          resolved_at
        FROM anomalies
        WHERE id = $1
        `,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Anomaly not found" });
      }

      return res.json({ ok: true, anomaly: result.rows[0] });
    } catch (err) {
      console.error("[anomalies] GET /:id error:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch anomaly",
      });
    }
  });

  /* =========================
     POST /api/v1/anomalies
     Create anomaly (ADMIN ONLY)
     DB columns: rule_code, tag, device_id, antenna_role, details, status
  ========================= */
  router.post("/", async (req, res) => {
    try {
      const ruleCode = normalizeRuleCode(req.body?.rule_code);
      const tag = String(req.body?.tag || "").trim();
      const device_id = req.body?.device_id ? String(req.body.device_id).trim() : null;
      const antenna_role = req.body?.antenna_role
        ? String(req.body.antenna_role).trim()
        : null;
      const details = normalizeDetails(req.body?.details);
      const status = normalizeStatus(req.body?.status);

      if (!ruleCode) {
        return res.status(400).json({
          ok: false,
          error: "rule_code is required",
        });
      }

      if (!tag) {
        return res.status(400).json({
          ok: false,
          error: "tag is required",
        });
      }

      if (!status) {
        return res.status(400).json({
          ok: false,
          error: "status must be one of open, ack, resolved",
        });
      }

      if (!details) {
        return res.status(400).json({
          ok: false,
          error: "details must be a JSON object",
        });
      }

      const ruleResult = await pool.query(
        `
        SELECT code, enabled
        FROM anomaly_rules
        WHERE code = $1
        LIMIT 1
        `,
        [ruleCode]
      );

      if (!ruleResult.rowCount) {
        return res.status(400).json({
          ok: false,
          error: `Invalid rule_code: ${ruleCode}`,
        });
      }

      if (ruleResult.rows[0]?.enabled === false) {
        return res.status(400).json({
          ok: false,
          error: `Rule is disabled: ${ruleCode}`,
        });
      }

      const result = await pool.query(
        `
        INSERT INTO anomalies (
          rule_code,
          tag,
          device_id,
          antenna_role,
          details,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [ruleCode, tag, device_id, antenna_role, details, status]
      );

      // SSE broadcast (optional)
      try {
        const broadcast = req.app.locals.broadcastEvent;
        if (typeof broadcast === "function") {
          broadcast("anomaly", result.rows[0]);
        }
      } catch (e) {
        console.warn("[anomalies] SSE broadcast failed:", e);
      }

      return res.json({ ok: true, anomaly: result.rows[0] });
    } catch (err) {
      console.error("[anomalies] POST / error:", err);

      if (err?.code === "42P01") {
        return res.status(500).json({
          ok: false,
          error: "Anomaly schema missing. Run migrations.",
        });
      }

      if (err?.code === "23503" && err?.constraint === "anomalies_rule_code_fkey") {
        return res.status(400).json({
          ok: false,
          error: "Invalid rule_code",
        });
      }

      if (err?.code === "23502") {
        return res.status(400).json({
          ok: false,
          error: `${err.column || "required field"} is required`,
        });
      }

      if (err?.code === "23514") {
        return res.status(400).json({
          ok: false,
          error: "Invalid anomalies payload",
        });
      }

      return res.status(500).json({
        ok: false,
        error: "Failed to create anomaly",
      });
    }
  });

  /* =========================
     PUT /api/v1/anomalies/:id/resolve
     Resolve anomaly (ADMIN ONLY)
     DB has resolved_at + status
  ========================= */
  router.put("/:id/resolve", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        UPDATE anomalies
        SET
          status = 'resolved',
          resolved_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Anomaly not found" });
      }

      return res.json({ ok: true, anomaly: result.rows[0] });
    } catch (err) {
      console.error("[anomalies] PUT /:id/resolve error:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to resolve anomaly",
      });
    }
  });

  /* =========================
     DELETE /api/v1/anomalies/:id
     Delete anomaly (ADMIN ONLY)
  ========================= */
  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        DELETE FROM anomalies
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Anomaly not found" });
      }

      return res.json({ ok: true, deleted: result.rows[0] });
    } catch (err) {
      console.error("[anomalies] DELETE /:id error:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to delete anomaly",
      });
    }
  });

  return router;
};
