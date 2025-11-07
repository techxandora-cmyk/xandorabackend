const express = require('express');
const router = express.Router();
const db = require('../../services/db');
const cache = require('../../services/cache');
const rabbit = require('../../services/rabbit');
const logger = require('../../services/logger');

/**
 * POST /api/v1/exit/check
 * body: { reader_id, location_id, epcs: [ "EPC-1", "EPC-2", ... ], timestamp }
 */
router.post('/check', async (req, res) => {
  try {
    const { reader_id, location_id, epcs, timestamp } = req.body || {};
    if (!Array.isArray(epcs) || epcs.length === 0) {
      return res.status(400).json({ error: 'epcs required' });
    }

    const normalized = Array.from(new Set(epcs.map(e => String(e).trim()).filter(Boolean)));
    if (normalized.length === 0) return res.status(400).json({ error: 'no valid epcs' });

    // Try Redis mget first
    const cacheKeys = normalized.map(e => `tag:${e}:status`);
    let cacheResults = [];
    try {
      cacheResults = await cache.mget(cacheKeys); // returns array aligned with keys
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : err }, 'Redis mget failed - falling back to DB');
      cacheResults = cacheKeys.map(() => null);
    }

    const statuses = {}; // epc -> { status, reserved_txn }
    const missing = [];

    cacheResults.forEach((val, i) => {
      if (val) {
        try {
          statuses[normalized[i]] = JSON.parse(val);
        } catch (e) {
          statuses[normalized[i]] = { status: String(val) };
        }
      } else {
        missing.push(normalized[i]);
      }
    });

    // Query DB for missing items
    if (missing.length) {
      const placeholders = missing.map(() => '?').join(',');
      const q = `SELECT epc, sale_status, reserved_txn, last_scanned_at FROM tags WHERE epc IN (${placeholders})`;
      const [rows] = await db.query(q, missing);
      const seen = new Set();
      for (const r of rows) {
        statuses[r.epc] = { status: r.sale_status || 'IN_STOCK', reserved_txn: r.reserved_txn || null, last_scanned_at: r.last_scanned_at || null };
        seen.add(r.epc);
        // best-effort cache fill
        try {
          cache.set(`tag:${r.epc}:status`, JSON.stringify(statuses[r.epc]), 'EX', 10).catch(()=>{});
        } catch (e){/* ignore */}
      }
      // any missing not in DB => unknown
      missing.filter(e => !seen.has(e)).forEach(e => {
        statuses[e] = { status: 'UNKNOWN' };
        try { cache.set(`tag:${e}:status`, JSON.stringify(statuses[e]), 'EX', 10).catch(()=>{}); } catch {}
      });
    }

    // Evaluate offenders
    const offenders = [];
    for (const epc of normalized) {
      const s = statuses[epc] || { status: 'UNKNOWN' };
      let allow = true;
      let reason = null;

      switch ((s.status || 'UNKNOWN').toUpperCase()) {
        case 'SOLD':
        case 'RETURNED':
          allow = true;
          break;
        case 'RESERVED':
          allow = false;
          reason = 'reserved_for_other_txn';
          break;
        case 'LOCKED':
          allow = false;
          reason = 'locked';
          break;
        case 'IN_STOCK':
        case 'UNKNOWN':
        default:
          allow = false;
          reason = 'not_sold';
      }

      if (!allow) offenders.push({ epc, status: s.status, reason, reserved_txn: s.reserved_txn || null });
    }

    // Log the exit check
    const now = (timestamp ? timestamp : new Date().toISOString()).slice(0,19).replace('T',' ');
    const events = normalized.map(epc => [
      epc,
      'EXIT_CHECK',
      reader_id || 'exit_reader',
      JSON.stringify({ location_id, offenders: offenders.find(o=>o.epc===epc) || null }),
      now
    ]);
    try {
      if (events.length) {
        await db.query('INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?', [events]);
      }
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : err }, 'Failed to insert exit check events');
    }

    const allowed = offenders.length === 0;

    // If not allowed, publish security alert
    if (!allowed) {
      try {
        await rabbit.publish('security_alerts', { reader_id, location_id, timestamp: now, offenders });
      } catch (err) {
        logger.warn({ err: err && err.message ? err.message : err }, 'Failed to publish security_alerts');
      }
    }

    return res.json({ allowed, offenders });
  } catch (err) {
    logger.error({ err: err && err.message ? err.message : err }, 'exit/check error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
