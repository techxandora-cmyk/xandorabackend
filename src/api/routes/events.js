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
      const data = body.data && typeof body.data === "object" ? body.data : body;

      pushEvent(eventType, data);

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
