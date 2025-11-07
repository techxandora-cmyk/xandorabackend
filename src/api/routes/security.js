// src/api/routes/security.js
const express = require('express');
const router = express.Router();

const db = require('../../services/db');
const rabbit = require('../../services/rabbit');
const cache = require('../../services/cache');
const logger = require('../../services/logger');

// bus is optional – if not present, we no-op so the route won't crash
let bus = { emit: () => {} };
try {
  bus = require('../../services/bus');
} catch (_) { /* noop */ }

/**
 * POST /api/v1/security/scan
 * body: {
 *   device_id?: "EXIT-01",
 *   device_type?: "exit_gate",
 *   reader_id: "EXIT-1",
 *   location_id: "STORE-EXIT-1",
 *   client_ts?: "2025-10-26T12:01:02Z",
 *   batch_id?: "uuid",
 *   epcs: ["EPC-1","EPC-2"] | [{epc:"EPC-1"}, ...]
 * }
 */
router.post('/scan', async (req, res) => {
  try {
    const body = req.body || {};
    const {
      device_id = null,
      device_type = 'exit_gate',
      reader_id = null,
      location_id = null,
      client_ts = null,
      batch_id = null,
      epcs = []
    } = body;

    // basic validation
    if (!Array.isArray(epcs) || epcs.length === 0) {
      return res.status(400).json({ error: 'epcs required' });
    }

    // normalize EPCs: extract .epc if objects, trim, uniq, non-empty
    const normalized = Array.from(
      new Set(
        epcs
          .map(e => (typeof e === 'string' ? e : e && e.epc))
          .map(e => String(e || '').trim())
          .filter(Boolean)
      )
    );

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'no valid epcs' });
    }

    // query DB for current sale_status / reserved_txn
    let rows = [];
    try {
      const placeholders = normalized.map(() => '?').join(',');
      const sql = `SELECT epc, sale_status, reserved_txn
                     FROM tags
                    WHERE epc IN (${placeholders})`;
      const [dbRows] = await db.query(sql, normalized);
      rows = dbRows || [];
    } catch (e) {
      logger.warn({ err: e?.message || e }, 'security/scan: db query failed');
      rows = [];
    }

    const byEpc = new Map(rows.map(r => [r.epc, r]));
    // Treat anything NOT SOLD as a match at the gate
    const matched = normalized.filter(epc => {
      const rec = byEpc.get(epc);
      const status = (rec && rec.sale_status) || 'IN_STOCK';
      return status !== 'SOLD';
    });

    // best-effort tag_events log (SECURITY_SCAN + SECURITY_MATCH for matched)
    try {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const scanEvents = normalized.map(epc => [
        epc,
        'SECURITY_SCAN',
        'security_api',
        JSON.stringify({ reader_id, location_id, device_id, device_type, batch_id }),
        now
      ]);

      const matchEvents = matched.map(epc => [
        epc,
        'SECURITY_MATCH',
        'security_api',
        JSON.stringify({ reader_id, location_id, device_id, device_type, batch_id }),
        now
      ]);

      const all = [...scanEvents, ...matchEvents];
      if (all.length) {
        await db.query(
          'INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?',
          [all]
        );
      }
    } catch (e) {
      logger.warn({ err: e?.message || e }, 'security/scan: tag_events insert failed (best-effort)');
    }

    // publish to rabbit (best-effort)
    try {
      await rabbit.publish('security_events', {
        type: 'SECURITY_SCAN',
        device_id,
        device_type,
        reader_id,
        location_id,
        client_ts,
        batch_id,
        processed_count: normalized.length,
        matched_count: matched.length,
        matched: matched.slice(0, 50), // limit payload size
      });
    } catch (_) { /* noop */ }

    // local bus (best-effort)
    try {
      bus.emit('SECURITY_SCAN', {
        device_id,
        device_type,
        reader_id,
        location_id,
        client_ts,
        batch_id,
        processed_count: normalized.length,
        matched_count: matched.length,
        matched: matched.slice(0, 50),
      });
    } catch (_) { /* noop */ }

    return res.json({
      accepted: true,
      device_id,
      device_type,
      reader_id,
      location_id,
      batch_id,
      processed_count: normalized.length,
      matched_count: matched.length,
      matched: matched.slice(0, 20) // small sample back to client
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'security/scan error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
