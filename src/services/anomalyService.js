// src/services/anomalyService.js
// AnomalyService - expanded rule set for anti-theft + inventory checks
const { DateTime } = require('luxon');

class AnomalyService {
  constructor(pool, opts = {}) {
    this.pool = pool;
    // options default
    this.opts = Object.assign({
      // windows and thresholds (can be overridden per-rule via DB rule config later)
      fastReentryMs: 2000,
      pingPongWindowSec: 60,
      pingPongMaxBounces: 4,
      multiDeviceMs: 2500,
      reappearMinutes: 10,
      rapidExitMaxSeconds: 120,
      missingPosWindowMinutes: 120, // look back window to find sale
      afterHoursDefault: { open: '09:00', close: '21:00', tz: 'Asia/Colombo' }
    }, opts);

    // you can expand this list or load dynamic rules from DB in the future
    this.rules = [
      { code: 'FAST_REENTRY',    fn: this.ruleFastReentry.bind(this) },
      { code: 'PING_PONG',       fn: this.rulePingPong.bind(this) },
      { code: 'MULTI_DEVICE',    fn: this.ruleMultiDevice.bind(this) },
      { code: 'REAPPEAR',        fn: this.ruleReappear.bind(this) },
      { code: 'RAPID_EXIT',      fn: this.ruleRapidExit.bind(this) },
      { code: 'MISSING_POS',     fn: this.ruleMissingPos.bind(this) },
      { code: 'INVENTORY_MISMATCH', fn: this.ruleInventoryMismatch.bind(this) },
      { code: 'AFTER_HOURS',     fn: this.ruleAfterHours.bind(this) }
    ];
  }

  // Public entry: evaluate a batch of scans (array of {tag, device_id, antenna_role, ts})
  async evaluateAndPersist(scans) {
    if (!Array.isArray(scans) || scans.length === 0) return;

    for (const scan of scans) {
      try {
        const history = await this.loadRecentForTag(scan.tag);
        for (const r of this.rules) {
          try {
            const details = await r.fn(scan, history, r);
            if (details) {
              await this.recordAnomaly(r, scan, details);
            }
          } catch (e) {
            console.error(`[Anomaly][${r.code}] rule error:`, e && e.message ? e.message : e);
          }
        }
      } catch (e) {
        console.error('[Anomaly] evaluate error:', e && e.message ? e.message : e);
      }
    }
  }

  // Load recent scans for the same tag (most recent first)
  async loadRecentForTag(tag, limit = 20) {
    try {
      const { rows } = await this.pool.query(
        `SELECT tag, device_id, antenna_role, ts FROM scan_items WHERE tag = $1 ORDER BY ts DESC LIMIT $2`,
        [tag, limit]
      );
      return rows || [];
    } catch (e) {
      // if scan_items doesn't exist or query fails, return empty array
      return [];
    }
  }

  // -----------------------
  // Rule implementations
  // -----------------------

  // FAST_REENTRY: same tag scanned twice very quickly
  ruleFastReentry(scan, history, ruleMeta) {
    if (!history || !history.length) return false;
    const prev = history[0];
    const now = new Date(scan.ts).getTime();
    const prevTs = new Date(prev.ts).getTime();
    if (now - prevTs > 0 && now - prevTs <= this.opts.fastReentryMs) {
      return {
        reason: 'FAST_REENTRY',
        message: 'Tag scanned twice in very short interval',
        previous: prev,
        deltaMs: now - prevTs
      };
    }
    return false;
  }

  // PING_PONG: bouncing ENTRY<->EXIT many times within a window
  async rulePingPong(scan, history, ruleMeta) {
    const windowSec = this.opts.pingPongWindowSec;
    const maxBounces = this.opts.pingPongMaxBounces;

    if (!scan.antenna_role) return false;

    try {
      const { rows } = await this.pool.query(
        `
        SELECT antenna_role, ts
        FROM scan_items
        WHERE tag = $1
          AND ts >= (to_timestamp(extract(epoch from $2::timestamptz)) - make_interval(secs => $3))
        ORDER BY ts DESC
        LIMIT 50
        `,
        [scan.tag, scan.ts, windowSec]
      );

      const roles = rows.map(r => (r.antenna_role || '').toUpperCase()).filter(Boolean);
      if (roles.length < 2) return false;

      let bounces = 0;
      for (let i = 1; i < roles.length; i++) {
        const a = roles[i - 1];
        const b = roles[i];
        if ((a === 'ENTRY' && b === 'EXIT') || (a === 'EXIT' && b === 'ENTRY')) bounces++;
      }
      if (bounces >= maxBounces) {
        return { reason: 'PING_PONG', message: 'Frequent ENTRY/EXIT bounces', bounces, windowSec };
      }
    } catch (e) {
      // ignore DB errors for this non-critical rule
    }
    return false;
  }

  // MULTI_DEVICE: same tag seen by different devices quickly
  async ruleMultiDevice(scan, history, ruleMeta) {
    if (!history || !history.length) return false;
    const prev = history[0];
    if (!prev.device_id) return false;
    if (prev.device_id === scan.device_id) return false;

    const now = new Date(scan.ts).getTime();
    const prevTs = new Date(prev.ts).getTime();
    if (Math.abs(now - prevTs) <= this.opts.multiDeviceMs) {
      return {
        reason: 'MULTI_DEVICE',
        message: 'Tag read at two different devices in short time',
        prevDevice: prev.device_id,
        newDevice: scan.device_id,
        deltaMs: Math.abs(now - prevTs)
      };
    }
    return false;
  }

  // REAPPEAR: tag leaving (in_store=false) then reappears quickly
  ruleReappear(scan, history, ruleMeta) {
    if (!history || !history.length) return false;
    const prev = history[0];
    // prev.in_store assumed from tag_state; if not present skip
    if (!prev || prev.in_store !== false) return false;
    const now = DateTime.fromISO(scan.ts);
    const prevTs = DateTime.fromISO(prev.ts || prev.last_seen_at);
    const diffMin = Math.abs(now.diff(prevTs, 'minutes').minutes);
    if (diffMin <= this.opts.reappearMinutes) {
      return {
        reason: 'REAPPEAR',
        message: 'Tag reappeared shortly after recorded exit',
        minutesSinceExit: Math.round(diffMin),
        prevRole: prev.antenna_role || prev.last_antenna_role
      };
    }
    return false;
  }

  // RAPID_EXIT: if prev role was AISLE or FITTING then immediate EXIT within X seconds
  ruleRapidExit(scan, history, ruleMeta) {
    const role = (scan.antenna_role || '').toUpperCase();
    if (role !== 'EXIT') return false;
    if (!history || !history.length) return false;
    const prev = history[0];
    const prevRole = (prev.antenna_role || '').toUpperCase();
    if (['AISLE', 'FITTING'].includes(prevRole)) {
      const dtScan = new Date(scan.ts).getTime();
      const dtPrev = new Date(prev.ts).getTime();
      const diffSec = Math.abs((dtScan - dtPrev) / 1000);
      if (diffSec <= this.opts.rapidExitMaxSeconds) {
        return {
          reason: 'RAPID_EXIT',
          message: 'Quick exit after being in AISLE/FITTING (possible theft)',
          prevRole,
          secondsSincePrev: Math.round(diffSec)
        };
      }
    }
    return false;
  }

  // AFTER_HOURS: scan outside store hours (configurable)
  ruleAfterHours(scan, history, ruleMeta) {
    const cfg = (ruleMeta && ruleMeta.config) || this.opts.afterHoursDefault;
    const tz = cfg.tz || this.opts.afterHoursDefault.tz;
    const t = DateTime.fromISO(scan.ts).setZone(tz);
    const [oH, oM] = String(cfg.open || '09:00').split(':').map(s => parseInt(s, 10));
    const [cH, cM] = String(cfg.close || '21:00').split(':').map(s => parseInt(s, 10));
    const open = t.set({ hour: oH, minute: oM, second: 0, millisecond: 0 });
    const close = t.set({ hour: cH, minute: cM, second: 0, millisecond: 0 });
    if (t < open || t > close) {
      return {
        reason: 'AFTER_HOURS',
        message: 'Scan detected outside store open hours',
        ts: scan.ts,
        tz,
        window: { open: open.toISO(), close: close.toISO() }
      };
    }
    return false;
  }

  // MISSING_POS: tag scanned (esp. at EXIT) but no corresponding POS sale found in configurable window
  async ruleMissingPos(scan, history, ruleMeta) {
    // Only check for scans that look like exits or ambiguous roles
    const role = (scan.antenna_role || '').toUpperCase();
    if (role && role !== 'EXIT' && role !== '') return false;

    // Determine lookback window (minutes)
    const windowMin = (ruleMeta && ruleMeta.config && ruleMeta.config.windowMin) || this.opts.missingPosWindowMinutes;
    const lookbackTs = DateTime.fromISO(scan.ts).minus({ minutes: windowMin }).toISO();

    // Best-effort POS lookup: try common table names in Postgres where POS sync may have dumped sales
    const posQueries = [
      // pos_transactions with items_count or total_amount
      {
        sql: `SELECT COUNT(*)::int AS c FROM pos_transactions WHERE ts >= $1 AND (tag = $2 OR EXISTS (SELECT 1 FROM pos_items WHERE pos_items.tx_id = pos_transactions.id AND pos_items.tag = $2))`,
        params: [lookbackTs, scan.tag]
      },
      // pos_sales_items style
      {
        sql: `SELECT COUNT(*)::int AS c FROM pos_sales_items WHERE ts >= $1 AND tag = $2`,
        params: [lookbackTs, scan.tag]
      },
      // pos_orders / pos_order_items
      {
        sql: `SELECT COUNT(*)::int AS c FROM pos_order_items WHERE created_at >= $1 AND tag = $2`,
        params: [lookbackTs, scan.tag]
      },
      // fallback: check pos_transactions text columns for tag
      {
        sql: `SELECT COUNT(*)::int AS c FROM pos_transactions WHERE ts >= $1 AND COALESCE(external_tags, '') LIKE '%' || $2 || '%'`,
        params: [lookbackTs, scan.tag]
      }
    ];

    try {
      for (const q of posQueries) {
        try {
          const { rows } = await this.pool.query(q.sql, q.params);
          const c = Number(rows?.[0]?.c || 0);
          if (c > 0) {
            // found a matching sale -> not missing
            return false;
          }
        } catch (e) {
          // table absent or query error -> try next
        }
      }
    } catch (e) {
      // ignore global errors - treat as not found
    }

    // If reached here, no POS sale found in window -> flag anomaly
    return {
      reason: 'MISSING_POS',
      message: 'Tag scanned but not found in POS sales within configured window',
      windowMinutes: windowMin,
      ts: scan.ts
    };
  }

  // INVENTORY_MISMATCH: tag exists in inventory but stock or expected location mismatched
  async ruleInventoryMismatch(scan, history, ruleMeta) {
    // best-effort check for local inventory table
    try {
      const { rows } = await this.pool.query(
        `SELECT id, sku, name, location, qty_on_hand FROM inventory_items WHERE tag_id = $1 LIMIT 1`,
        [scan.tag]
      );
      if (!rows || rows.length === 0) return false;

      const itm = rows[0];
      // Example check: qty_on_hand zero but tag scanned in store (possible inventory error)
      if (typeof itm.qty_on_hand === 'number' && itm.qty_on_hand <= 0) {
        return {
          reason: 'INVENTORY_MISMATCH',
          message: 'Tag exists in inventory but qty_on_hand is zero or negative',
          item: { id: itm.id, sku: itm.sku, name: itm.name, location: itm.location, qty_on_hand: itm.qty_on_hand },
          ts: scan.ts
        };
      }

      // Another check example: location mismatch - if tag scanned at a device with known location different from inventory location.
      // Try to read device -> location mapping if exists
      try {
        const dev = (await this.pool.query(`SELECT id, name, location FROM devices WHERE id = $1 LIMIT 1`, [scan.device_id])).rows[0];
        if (dev && dev.location && String(dev.location) !== String(itm.location)) {
          return {
            reason: 'INVENTORY_MISMATCH',
            message: 'Device location differs from inventory location for this tag',
            item: { id: itm.id, sku: itm.sku, name: itm.name, inventoryLocation: itm.location },
            device: { id: dev.id, name: dev.name, deviceLocation: dev.location },
            ts: scan.ts
          };
        }
      } catch (e) {
        // ignore device lookup failures
      }
    } catch (e) {
      // inventory table absent - skip
      return false;
    }
    return false;
  }

  // -----------------------
  // Persist anomaly + realtime emit
  // -----------------------
  async recordAnomaly(rule, scan, details) {
    try {
      // ensure anomalies table insert works with common schema
      await this.pool.query(
        `INSERT INTO anomalies (rule_code, tag, device_id, antenna_role, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          rule.code || (rule && rule.fn && rule.fn.name) || 'UNKNOWN_RULE',
          scan.tag,
          scan.device_id || null,
          scan.antenna_role || null,
          JSON.stringify(details || {}),
          scan.ts || new Date().toISOString()
        ]
      );
    } catch (e) {
      // if anomalies table doesn't exist or insert fails, log but continue
      console.error('[Anomaly] failed to persist anomaly:', e && e.message ? e.message : e);
    }

    // realtime emit (non-blocking)
    try {
      if (global.emitRealtime) {
        global.emitRealtime('anomaly:new', {
          rule_code: rule.code || (rule && rule.fn && rule.fn.name) || 'UNKNOWN',
          tag: scan.tag,
          device_id: scan.device_id,
          antenna_role: scan.antenna_role,
          details,
          ts: scan.ts
        });
      }
    } catch (e) {
      console.error('[Anomaly] emit failed:', e && e.message ? e.message : e);
    }
  }
}

module.exports = { AnomalyService };
