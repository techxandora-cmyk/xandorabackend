// src/api/routes/scan.js
const express = require('express');
const router = express.Router();
const db = require('../../services/db');
const logger = require('../../services/logger');

// very simple bearer auth (device token from `devices` table)
async function authDevice(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = (hdr.startsWith('Bearer ') ? hdr.slice(7) : '').trim();
    if (!token) return res.status(401).json({ error: 'missing auth' });

    const [rows] = await db.query(
      'SELECT id, store_id, active FROM devices WHERE token = ? LIMIT 1',
      [token]
    );
    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: 'invalid device' });
    }
    req.device = rows[0];
    next();
  } catch (err) {
    logger.error({ err }, 'scan auth error');
    return res.status(500).json({ error: 'internal' });
  }
}

/**
 * POST /api/v1/scan/batch
 * body: { device_id, device_type, operator_id, reader_id, location_id, batch_id, epcs: [] }
 */
router.post('/batch', authDevice, async (req, res) => {
  try {
    let {
      device_id, device_type, operator_id,
      reader_id, location_id, batch_id, epcs
    } = req.body || {};

    if (!Array.isArray(epcs)) epcs = [];
    const count = epcs.length;

    // OPTIONAL: persist raw items per EPC (skip here to keep it light)

    // ALWAYS: log a single SCAN_BATCH event so metrics can count it
    try {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const payload = {
        device_id: device_id || req.device?.id || null,
        device_type: device_type || null,
        operator_id: operator_id || null,
        reader_id: reader_id || null,
        location_id: location_id || null,
        batch_id: batch_id || null,
        count,
        sample: epcs.slice(0, 20),
      };
      await db.query(
        'INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES (?, ?, ?, ?, ?)',
        ['-', 'SCAN_BATCH', 'scan_api', JSON.stringify(payload), now]
      );
    } catch (e) {
      // best-effort — do not fail the API
      logger.warn({ err: e?.message || e }, 'failed to write SCAN_BATCH event');
    }

    return res.json({ ok: true, scanned: count, batch_id: batch_id || null });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'scan/batch error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
