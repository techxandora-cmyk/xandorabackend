require('dotenv').config();
const rabbit = require('../services/rabbit');
const db = require('../services/db');
const cache = require('../services/cache');
const logger = require('../services/logger');

async function processJob(job) {
  // job: { batch_id, device_id, device_type, operator_id, reader_id, location_id, client_ts, epcs, received_at }
  const { batch_id, device_id, device_type, operator_id, reader_id, location_id, client_ts, epcs } = job;
  const nowSql = new Date().toISOString().slice(0,19).replace('T',' ');
  try {
    // 1) Idempotency: insert into scans audit table; if duplicate, skip processing
    try {
      await db.query(
        'INSERT INTO scans (batch_id, device_id, operator_id, reader_id, location_id, epc_count, client_ts, server_received_at, processed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [batch_id || null, device_id, operator_id || null, reader_id || null, location_id || null, epcs.length, client_ts || null, nowSql, 0]
      );
    } catch (err) {
      // duplicate entry (same batch_id+device_id) -> skip
      if (err && err.code === 'ER_DUP_ENTRY') {
        logger.info({ batch_id, device_id }, 'scan job already processed (duplicate batch_id)');
        return;
      }
      throw err;
    }

    // 2) Deduplicate within job (already done at ingestion, but double-check)
    const uniqueEpcs = Array.from(new Set(epcs.map(e => String(e).trim()).filter(Boolean)));
    if (uniqueEpcs.length === 0) return;

    // 3) Short-window dedupe using cache: skip epcs recently processed by same reader
    const toProcess = [];
    for (const epc of uniqueEpcs) {
      try {
        const recentKey = `recent_scan:${reader_id || device_id}:${epc}`;
        const seen = await cache.get(recentKey);
        if (seen) {
          // skip, recently processed
          continue;
        } else {
          // mark as seen for short TTL (10s)
          await cache.set(recentKey, '1', 'EX', 10).catch(()=>{});
          toProcess.push(epc);
        }
      } catch (e) {
        // if cache fails, just add to process to avoid data loss
        toProcess.push(epc);
      }
    }

    if (toProcess.length === 0) {
      // mark scans processed
      await db.query('UPDATE scans SET processed = 1 WHERE batch_id = ? AND device_id = ?', [batch_id || null, device_id]);
      return;
    }

    // 4) Bulk upsert tags:
    // Prepare rows for bulk insert: epc, location_id, created_at, updated_at, last_scanned_at
    const rows = toProcess.map(epc => [epc, location_id || null, nowSql, nowSql, nowSql]);
    // Use INSERT ... ON DUPLICATE KEY UPDATE to set last_scanned_at and location_id
    // Adjust columns to match your tags schema
    await db.query(
      'INSERT INTO tags (epc, location_id, created_at, updated_at, last_scanned_at) VALUES ? ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at), last_scanned_at=VALUES(last_scanned_at), location_id=VALUES(location_id)',
      [rows]
    );

    // 5) Insert tag_events for audit (bulk)
    try {
      const events = toProcess.map(epc => [epc, 'SCAN', device_id || reader_id || 'device', JSON.stringify({ device_id, device_type, operator_id, reader_id, location_id }), nowSql]);
      if (events.length) await db.query('INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?', [events]);
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : e }, 'tag_events insert failed');
    }

    // 6) Check sale_status for those epcs to decide security alerts (only for exit_gate)
    if ((device_type || '').toLowerCase() === 'exit_gate') {
      // fetch statuses
      const placeholders = toProcess.map(() => '?').join(',');
      const [rowsStatus] = await db.query(`SELECT epc, sale_status, reserved_txn FROM tags WHERE epc IN (${placeholders})`, toProcess);
      const statusMap = new Map(rowsStatus.map(r => [r.epc, { sale_status: r.sale_status || 'IN_STOCK', reserved_txn: r.reserved_txn || null }]));

      const offenders = [];
      for (const epc of toProcess) {
        const s = statusMap.get(epc) || { sale_status: 'UNKNOWN' };
        const st = (s.sale_status || 'UNKNOWN').toUpperCase();
        let allow = true;
        let reason = null;
        switch (st) {
          case 'SOLD':
            allow = false;
            reason = 'sold';
            break;
          case 'RESERVED':
            allow = false;
            reason = 'reserved';
            break;
          case 'RETURNED':
            allow = true;
            break;
          case 'IN_STOCK':
          case 'UNKNOWN':
          default:
            allow = false;
            reason = 'not_sold';
        }
        if (!allow) {
          offenders.push({ epc, status: st, reason, reserved_txn: s.reserved_txn || null });
        }
      }

      if (offenders.length) {
        // insert security_alerts row
        try {
          const offendersJson = JSON.stringify(offenders);
          await db.query(
            'INSERT INTO security_alerts (reader_id, location_id, timestamp, offenders, acknowledged) VALUES (?, ?, ?, ?, 0)',
            [reader_id || device_id, location_id || null, nowSql, offendersJson]
          );
        } catch (e) {
          logger.warn({ err: e && e.message ? e.message : e }, 'failed insert security_alerts');
        }

        // list publish to Rabbit for real-time consumers
        try {
          await rabbit.publish('security_alerts', { reader_id: reader_id || device_id, location_id: location_id || null, timestamp: nowSql, offenders });
        } catch (e) {
          logger.warn({ err: e && e.message ? e.message : e }, 'failed publish security_alerts');
        }
      }
    }

    // 7) mark scans processed
    try {
      await db.query('UPDATE scans SET processed = 1 WHERE batch_id = ? AND device_id = ?', [batch_id || null, device_id]);
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : e }, 'failed mark scans processed');
    }

    logger.info({ device_id, batch_id, processed: toProcess.length }, 'scan job processed');
  } catch (err) {
    logger.error({ err: err && err.message ? err.message : err }, 'processJob error');
    throw err;
  }
}

async function start() {
  logger.info('🚀 Scan worker starting up...');
  await rabbit.connect();
  logger.info('✅ Connected to RabbitMQ');

  // Consume messages from scan_jobs queue
  await rabbit.consume('scan_jobs', async (msg) => {
    try {
      await processJob(msg);
      // rabbit wrapper should ack automatically on success
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : err }, 'Error processing scan job');
      throw err; // allow rabbit wrapper to nack/retry according to its policy
    }
  });

  logger.info('👷‍♂️ Scan worker listening for jobs...');
}

if (require.main === module) {
  start().catch(err => {
    logger.error({ err: err && err.message ? err.message : err }, 'scanWorker failed to start');
    process.exit(1);
  });
}

module.exports = { start, processJob };
