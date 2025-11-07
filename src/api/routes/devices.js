// src/api/routes/devices.js
const express = require("express");
const router = express.Router();
const db = require("../../services/db");

// Upsert (create/update) a device and touch last_seen
router.post("/upsert", async (req, res) => {
  try {
    const { id, name, store_id, active } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: "id & name required" });

    await db.query(
      `INSERT INTO devices (id, name, store_id, active, last_seen)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         store_id = VALUES(store_id),
         active = VALUES(active),
         last_seen = COALESCE(VALUES(last_seen), NOW())`,
      [id, name, store_id ?? "STORE-1", active ?? 1]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("devices/upsert error", err);
    res.status(500).json({ error: "internal" });
  }
});

// Heartbeat (just updates last_seen)
router.post("/heartbeat", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });

    await db.query(`UPDATE devices SET last_seen = NOW() WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("devices/heartbeat error", err);
    res.status(500).json({ error: "internal" });
  }
});

// List devices with derived status; tolerant of NULLs and missing updated_at
router.get("/", async (_req, res) => {
  try {
    // Select only columns that definitely exist; compute lag safely
    const [rows] = await db.query(
      `SELECT
         id, name, store_id, active, last_seen
       FROM devices
       ORDER BY COALESCE(last_seen, TIMESTAMP('1970-01-01')) DESC, id ASC
       LIMIT 500`
    );

    const now = Date.now();
    const devices = (rows || []).map((d) => {
      const lastSeenMs = d.last_seen ? new Date(d.last_seen).getTime() : 0;
      const lag = lastSeenMs ? Math.floor((now - lastSeenMs) / 1000) : Number.MAX_SAFE_INTEGER;
      const status = lag <= 30 ? "online" : lag <= 120 ? "idle" : "offline";
      return { ...d, lag, status };
    });

    res.json({ devices });
  } catch (err) {
    console.error("devices/list failed", err);
    res.status(500).json({ error: "internal" });
  }
});

module.exports = router;
