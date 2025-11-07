require('dotenv').config();
const rabbit = require('../services/rabbit');
const db = require('../services/db');
const logger = require('../services/logger');

async function storeAlert(msg) {
  // expected msg: { reader_id, location_id, timestamp, offenders: [{epc, status, reason, reserved_txn}] }
  if (!msg) throw new Error('empty alert');
  const readerId = msg.reader_id || null;
  const locationId = msg.location_id || null;
  const ts = msg.timestamp ? new Date(msg.timestamp) : new Date();
  const tsSql = ts.toISOString().slice(0,19).replace('T',' ');
  const offendersJson = JSON.stringify(msg.offenders || []);
  try {
    await db.query(
      'INSERT INTO security_alerts (reader_id, location_id, timestamp, offenders, created_at) VALUES (?, ?, ?, ?, ?)',
      [readerId, locationId, tsSql, offendersJson, tsSql]
    );
    logger.info({ readerId, locationId }, 'Stored security_alert');
  } catch (err) {
    logger.error({ err: err && err.message ? err.message : err }, 'Failed to store security_alert');
    throw err;
  }
}

async function start() {
  logger.info('🚀 Alerts worker starting up...');
  await rabbit.connect();
  logger.info('✅ Connected to RabbitMQ');

  await rabbit.consume('security_alerts', async (msg) => {
    try {
      logger.info({ msgSummary: { reader_id: msg.reader_id, offenders_count: Array.isArray(msg.offenders) ? msg.offenders.length : 0 } }, '📦 Received security_alert');
      await storeAlert(msg);
      logger.info('👷‍♂️ security_alert processed');
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : err }, '❌ Error processing security_alert');
      throw err; // allow rabbit wrapper to nack/retry
    }
  });

  logger.info('👷‍♂️ Alerts worker listening for security_alerts...');
}

if (require.main === module) {
  start().catch(err => {
    logger.error({ err: err && err.message ? err.message : err }, 'Alerts worker failed to start');
    process.exit(1);
  });
}

module.exports = { start, storeAlert };
