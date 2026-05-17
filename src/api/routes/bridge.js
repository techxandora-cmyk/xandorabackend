const express = require("express");
const { lookupScanToken } = require("./lib/scanTokens");

module.exports = function buildBridgeRoutes(pool) {
  const router = express.Router();

  // Bridge calls this on startup with its STORE_TOKEN to get its full config.
  // Returns: store context + all registered readers for that store.
  router.get("/config", async (req, res) => {
    const rawToken =
      req.headers["x-store-token"] ||
      req.headers["x-scan-key"] ||
      req.query.token;

    if (!rawToken) {
      return res.status(400).json({ ok: false, error: "x-store-token header required" });
    }

    const tokenRow = await lookupScanToken(pool, String(rawToken).trim()).catch(() => null);

    if (!tokenRow || !tokenRow.is_active) {
      return res.status(403).json({ ok: false, error: "Invalid or inactive store token" });
    }

    if (tokenRow.token_type !== "store") {
      return res.status(400).json({ ok: false, error: "A store token (st_...) is required" });
    }

    try {
      const readersResult = await pool.query(
        `SELECT device_id, reader_ip, reader_name, zone_id
         FROM registered_readers
         WHERE store_id = $1 AND company_name = $2 AND is_active = TRUE
         ORDER BY id`,
        [tokenRow.store_id, tokenRow.company_name]
      );

      return res.json({
        ok: true,
        store_id: tokenRow.store_id,
        company_name: tokenRow.company_name,
        readers: readersResult.rows,
      });
    } catch (e) {
      console.error("[bridge/config]", e);
      return res.status(500).json({ ok: false, error: "Failed to load bridge config" });
    }
  });

  // Bridge calls this to report a reader as online/offline
  router.post("/heartbeat", async (req, res) => {
    const rawToken =
      req.headers["x-store-token"] ||
      req.headers["x-scan-key"];

    const tokenRow = await lookupScanToken(pool, String(rawToken || "").trim()).catch(() => null);
    if (!tokenRow?.is_active) {
      return res.status(403).json({ ok: false, error: "Invalid token" });
    }

    const { reader_ip, device_id } = req.body || {};
    if (!reader_ip) return res.status(400).json({ ok: false, error: "reader_ip required" });

    try {
      const values = [tokenRow.store_id, tokenRow.company_name, reader_ip];
      let deviceClause = "";
      if (device_id) {
        values.push(String(device_id).trim());
        deviceClause = ` AND device_id = $${values.length}`;
      }

      await pool.query(
        `UPDATE registered_readers
         SET last_seen_at = NOW(), updated_at = NOW()
         WHERE store_id = $1
           AND company_name = $2
           AND reader_ip = $3
           ${deviceClause}`,
        values
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Failed to update heartbeat" });
    }
  });

  return router;
};
