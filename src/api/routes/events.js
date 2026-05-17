const express = require("express");

const clients = new Set();
const recentEvents = [];
const MAX_RECENT_EVENTS = 500;

function pushEvent(event, data) {
  const payloadObj = data || {};
  const payload = JSON.stringify(payloadObj);

  recentEvents.push({
    event,
    data: payloadObj,
    ts: new Date().toISOString(),
  });
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }

  for (const c of clients) {
    try {
      c.res.write(`event: ${event}\n`);
      c.res.write(`data: ${payload}\n\n`);
    } catch {}
  }
}

function clearRecentEvents() {
  const cleared = recentEvents.length;
  recentEvents.length = 0;
  return cleared;
}

module.exports = function buildEventsRoutes(pool) {
  const router = express.Router();
  const expectedScanKey = process.env.SCAN_API_KEY || "xandora_reader_001";
  const { lookupScanToken } = require("./lib/scanTokens");

  router.get("/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

    const client = { res };
    clients.add(client);

    req.on("close", () => clients.delete(client));
  });

  router.get("/recent", (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), MAX_RECENT_EVENTS);
    return res.json({
      ok: true,
      count: Math.min(limit, recentEvents.length),
      events: recentEvents.slice(-limit),
    });
  });

  // Device-side ingest endpoint for middleware decision events.
  router.post("/ingest", async (req, res) => {
    try {
      const key =
        req.headers["x-scan-key"] ||
        req.headers["x-api-key"] ||
        req.headers["x-xandora-scan-key"];

      const isValidLegacyKey = key && key === expectedScanKey;
      const isTokenKey = key && (key.startsWith("st_") || key.startsWith("ct_"));
      const tokenRow = isTokenKey
        ? await lookupScanToken(pool, key).catch(() => null)
        : null;

      if (!isValidLegacyKey && !(tokenRow?.is_active)) {
        return res.status(403).json({
          ok: false,
          error: "Forbidden (scan key required)",
        });
      }

      const body = req.body || {};
      const eventType = String(body.event_type || body.event || "rfid_decision");
      const incomingData = body.data && typeof body.data === "object" ? body.data : body;
      const data = { ...incomingData };

      if (tokenRow?.is_active) {
        const tokenType = String(tokenRow.token_type || "").trim().toLowerCase();
        const tokenCompany = String(tokenRow.company_name || "").trim();
        const tokenStore = String(tokenRow.store_id || "").trim();
        const deviceId = String(data.device_id || "").trim();

        if (tokenType === "store") {
          data.company_name = tokenCompany;
          data.store_id = tokenStore;
        } else if (tokenType === "company") {
          const requestedStore = String(data.store_id || "").trim();
          if (!requestedStore) {
            return res.status(400).json({
              ok: false,
              error: "store_id required for company token",
            });
          }

          const storeResult = await pool.query(
            `SELECT 1
             FROM company_stores
             WHERE company_name = $1
               AND store_id = $2
               AND is_active = TRUE
             LIMIT 1`,
            [tokenCompany, requestedStore]
          );
          if (storeResult.rowCount === 0) {
            return res.status(403).json({
              ok: false,
              error: "Store is not active for this company token",
            });
          }

          data.company_name = tokenCompany;
          data.store_id = requestedStore;
        }

        if (deviceId) {
          const readerResult = await pool.query(
            `SELECT 1
             FROM registered_readers
             WHERE company_name = $1
               AND store_id = $2
               AND device_id = $3
               AND is_active = TRUE
             LIMIT 1`,
            [tokenCompany, String(data.store_id || "").trim(), deviceId]
          );
          if (readerResult.rowCount === 0) {
            return res.status(403).json({
              ok: false,
              error: "Reader is not registered for this store",
            });
          }
        }
      }

      pushEvent(eventType, data);

      // Keep device last_seen current on bridge heartbeat events so the
      // reader doesn't appear offline when tags are being deduplicated.
      if (pool && data.device_id && (eventType === "dwell_heartbeat" || eventType === "entered_zone")) {
        pool.query(
          `UPDATE devices SET last_seen = NOW(), last_heartbeat = NOW(), status = 'online'
           WHERE device_id = $1`,
          [String(data.device_id)]
        ).catch(() => {});
        if (data.store_id) {
          pool.query(
            `UPDATE registered_readers SET last_seen_at = NOW(), updated_at = NOW()
             WHERE device_id = $1 AND store_id = $2`,
            [String(data.device_id), String(data.store_id)]
          ).catch(() => {});
        }
      }

      // Best effort persistence for analytics/audit
      if (pool && data.epc) {
        try {
          await pool.query(
            `
            INSERT INTO tag_events (epc, event_type, source, data)
            VALUES ($1, $2, $3, $4::jsonb)
            `,
            [
              String(data.epc),
              eventType,
              String(data.source || "llrp_bridge"),
              JSON.stringify(data),
            ]
          );
        } catch (e) {
          // Keep endpoint non-blocking if DB table/schema differs.
          console.warn("[events/ingest] tag_events insert skipped:", e.message);
        }
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[events/ingest]", err);
      return res.status(500).json({ ok: false, error: "Failed to ingest event" });
    }
  });

  router.broadcastEvent = pushEvent;
  router.pushEvent = pushEvent;

  return router;
};

module.exports.pushEvent = pushEvent;
module.exports.broadcastEvent = pushEvent;
module.exports.clearRecentEvents = clearRecentEvents;
