require('dotenv').config();
const rabbit = require('./services/rabbit');
const db = require('./services/db');
const cache = require('./services/cache');
const logger = require('./services/logger');

(async () => {
  try {
    await rabbit.connect();
    logger.info('Worker connected to RabbitMQ (queue: scan_jobs)');

    // Consume messages from scan_jobs queue
    await rabbit.consume('scan_jobs', async (msg) => {
      try {
        const job = JSON.parse(msg.content.toString());
        logger.info({ job }, 'Processing scan job');

        const epcs = job.epcs || [];
        if (!epcs.length) return;

        // Basic logic: mark scanned tags as "SCANNED" and log an event
        const placeholders = epcs.map(() => '?').join(',');
        const sql = `UPDATE tags 
                     SET last_seen=NOW(), updated_at=NOW()
                     WHERE epc IN (${placeholders})`;
        await db.query(sql, epcs);

        // Cache update best-effort
        for (const epc of epcs) {
          const key = `tag:${epc}:last_seen`;
          cache.set(key, new Date().toISOString(), 'EX', 300).catch(() => {});
        }

        // Insert events for audit
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const events = epcs.map(e => [e, 'SCAN', job.device_id || 'unknown', JSON.stringify(job), now]);
        await db.query('INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?', [events]);

        logger.info({ count: epcs.length }, 'Scan job processed successfully');
      } catch (err) {
        logger.error({ err: err.message }, 'Failed to process scan job');
      }
    });

  } catch (err) {
    logger.error({ err: err.message }, 'Worker startup failed');
    process.exit(1);
  }
})();
