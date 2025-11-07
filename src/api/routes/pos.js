// src/api/routes/pos.js
const express = require('express');
const router = express.Router();

const db = require('../../services/db');           // ✅ correct path
const cache = require('../../services/cache');     // optional redis wrapper
const rabbit = require('../../services/rabbit');   // RabbitMQ publisher
const logger = require('../../services/logger');   // pino/logger

// bus is optional: if ../../services/bus doesn't exist, we noop so app won't crash
let bus = { emit: () => {} };
try {
  bus = require('../../services/bus');
} catch (_) {
  // no-op: events will still be published to Rabbit via rabbit.publish below
}

/**
 * Helper - reserve tags
 * items: [{ epc, price }]
 */
async function reserveItems(items, posTxnId) {
  const epcs = (items || []).map(i => i.epc).filter(Boolean);
  if (epcs.length === 0) return 0;

  const placeholders = epcs.map(() => '?').join(',');
  const sql = `
    UPDATE tags
       SET sale_status='RESERVED',
           reserved_txn=?,
           updated_at=NOW()
     WHERE epc IN (${placeholders})
  `;
  const params = [posTxnId, ...epcs];
  const [res] = await db.query(sql, params);

  // best-effort cache
  try {
    for (const e of epcs) {
      const key = `tag:${e}:status`;
      cache.set(key, JSON.stringify({ status: 'RESERVED', reserved_txn: posTxnId }), 'EX', 300)
        .catch(() => {});
    }
  } catch (_) {}

  return res?.affectedRows || 0;
}

/**
 * Helper - confirm sale => SOLD and clear reserved_txn
 */
async function confirmItems(items) {
  const epcs = (items || []).map(i => i.epc).filter(Boolean);
  if (epcs.length === 0) return 0;

  const placeholders = epcs.map(() => '?').join(',');
  const sql = `
    UPDATE tags
       SET sale_status='SOLD',
           reserved_txn=NULL,
           updated_at=NOW()
     WHERE epc IN (${placeholders})
  `;
  const [res] = await db.query(sql, epcs);

  try {
    for (const e of epcs) {
      const key = `tag:${e}:status`;
      cache.set(key, JSON.stringify({ status: 'SOLD' }), 'EX', 300).catch(() => {});
    }
  } catch (_) {}

  return res?.affectedRows || 0;
}

/**
 * Helper - refund => RETURNED and clear reserved_txn
 */
async function refundItems(items) {
  const epcs = (items || []).map(i => i.epc).filter(Boolean);
  if (epcs.length === 0) return 0;

  const placeholders = epcs.map(() => '?').join(',');
  const sql = `
    UPDATE tags
       SET sale_status='RETURNED',
           reserved_txn=NULL,
           updated_at=NOW()
     WHERE epc IN (${placeholders})
  `;
  const [res] = await db.query(sql, epcs);

  try {
    for (const e of epcs) {
      const key = `tag:${e}:status`;
      cache.set(key, JSON.stringify({ status: 'RETURNED' }), 'EX', 300).catch(() => {});
    }
  } catch (_) {}

  return res?.affectedRows || 0;
}

/**
 * Upsert POS transaction
 */
async function upsertPosTransaction(posTxnId, storeId, userId, items, totalAmount, status) {
  const itemsJson = JSON.stringify(items || []);
  const sql = `
    INSERT INTO pos_transactions
      (pos_txn_id, store_id, user_id, items, total_amount, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      items = VALUES(items),
      total_amount = VALUES(total_amount),
      updated_at = NOW()
  `;
  const params = [posTxnId, storeId || null, userId || null, itemsJson, totalAmount || 0, status];
  await db.query(sql, params);
}

/**
 * Helper - write tag_events (best-effort)
 */
async function writeTagEvents(items, type, payload) {
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const rows = (items || []).map(i => [
      i.epc,
      type,
      'pos_api',
      JSON.stringify(payload),
      now
    ]);
    if (rows.length) {
      await db.query('INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?', [rows]);
    }
  } catch (e) {
    logger.warn({ err: e?.message || e }, 'failed to insert tag_events (best-effort)');
  }
}

/**
 * POST /api/v1/pos/reserve
 * body: { pos_txn_id, store_id, user, items: [{epc, price}], total }
 */
router.post('/reserve', async (req, res) => {
  try {
    const { pos_txn_id, store_id, user, items = [], total } = req.body || {};
    if (!pos_txn_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'pos_txn_id & items required' });
    }

    await upsertPosTransaction(pos_txn_id, store_id, user, items, total, 'RESERVED');
    const affected = await reserveItems(items, pos_txn_id);

    // events
    await writeTagEvents(items, 'POS_RESERVE', { pos_txn_id, store_id, user });

    // publish & bus
    rabbit.publish('pos_events', { type: 'POS_RESERVE', pos_txn_id, store_id, user, epcs: items.map(i => i.epc) }).catch(() => {});
    bus.emit('POS_RESERVE', { pos_txn_id, store_id, user, epcs: items.map(i => i.epc) });

    return res.json({ reserved: affected, pos_txn_id });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'pos/reserve error');
    return res.status(500).json({ error: 'internal' });
  }
});

/**
 * POST /api/v1/pos/confirm
 * body: { pos_txn_id, store_id, user, items: [{epc, price}], total }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { pos_txn_id, store_id, user, items = [], total } = req.body || {};
    if (!pos_txn_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'pos_txn_id & items required' });
    }

    await upsertPosTransaction(pos_txn_id, store_id, user, items, total, 'CONFIRMED');
    const affected = await confirmItems(items);

    await writeTagEvents(items, 'POS_CONFIRM', { pos_txn_id, store_id, user });

    rabbit.publish('pos_events', { type: 'POS_CONFIRM', pos_txn_id, store_id, user, epcs: items.map(i => i.epc) }).catch(() => {});
    bus.emit('POS_CONFIRM', { pos_txn_id, store_id, user, epcs: items.map(i => i.epc) });

    return res.json({ confirmed: affected, pos_txn_id });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'pos/confirm error');
    return res.status(500).json({ error: 'internal' });
  }
});

/**
 * POST /api/v1/pos/refund
 * body: { pos_txn_id, store_id, user, items: [{epc}] }
 */
router.post('/refund', async (req, res) => {
  try {
    const { pos_txn_id, store_id, user, items = [] } = req.body || {};
    if (!pos_txn_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'pos_txn_id & items required' });
    }

    await upsertPosTransaction(pos_txn_id, store_id, user, items, null, 'REFUNDED');
    const affected = await refundItems(items);

    await writeTagEvents(items, 'POS_REFUND', { pos_txn_id, store_id, user });

    rabbit.publish('pos_events', { type: 'POS_REFUND', pos_txn_id, store_id, user, epcs: items.map(i => i.epc) }).catch(() => {});
    bus.emit('POS_REFUND', { pos_txn_id, store_id, user, epcs: items.map(i => i.epc) });

    return res.json({ refunded: affected, pos_txn_id });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'pos/refund error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
