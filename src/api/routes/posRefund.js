const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../services/db');
const cache = require('../../services/cache');
const rabbit = require('../../services/rabbit');
const logger = require('../../services/logger');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const sig = signatureHeader.slice(prefix.length);
  const hmac = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(hmac, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

router.post('/', async (req, res) => {
  try {
    const secret = process.env.POS_WEBHOOK_SECRET;
    const signatureHeader = req.get('X-Signature') || req.get('x-signature') || '';
    const raw = req.rawBody || (req.body ? JSON.stringify(req.body) : '');

    if (!verifySignature(raw, signatureHeader, secret)) {
      logger.warn({ ip: req.ip }, 'pos/refund signature verification failed');
      return res.status(401).json({ error: 'invalid signature' });
    }

    const { pos_txn_id, store_id, epcs, total, reason } = req.body || {};
    if (!pos_txn_id || !Array.isArray(epcs) || epcs.length === 0) {
      return res.status(400).json({ error: 'pos_txn_id and epcs required' });
    }

    const normalized = epcs.map(e => String(e).trim()).filter(Boolean);
    if (normalized.length === 0) return res.status(400).json({ error: 'no valid epcs' });

    // upsert pos_transactions as REFUNDED (idempotent)
    const itemsJson = JSON.stringify(normalized.map(epc => ({ epc })));
    await db.query(
      `INSERT INTO pos_transactions (pos_txn_id, store_id, user_id, items, total_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'REFUNDED', NOW(), NOW())
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW(), items = VALUES(items), total_amount = VALUES(total_amount)`,
      [pos_txn_id, store_id || null, 'pos_refund', itemsJson, total || 0.0]
    );

    // update tags -> RETURNED
    const placeholders = normalized.map(() => '?').join(',');
    const tagSql = `UPDATE tags SET sale_status='RETURNED', reserved_txn=NULL, updated_at=NOW() WHERE epc IN (${placeholders})`;
    try {
      await db.query(tagSql, normalized);
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : err }, 'pos/refund tags update failed - continuing');
    }

    // write tag_events audit rows
    try {
      const now = new Date().toISOString().slice(0,19).replace('T',' ');
      const events = normalized.map(e => [e, 'POS_REFUND', 'pos_refund_api', JSON.stringify({ pos_txn_id, store_id, reason, total }), now]);
      if (events.length) await db.query('INSERT INTO tag_events (epc, event_type, source, data, created_at) VALUES ?', [events]);
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : err }, 'pos/refund tag_events failed');
    }

    // optional refund_audit table insert (best-effort)
    try {
      const now = new Date().toISOString().slice(0,19).replace('T',' ');
      await db.query(
        'INSERT INTO refund_audit (pos_txn_id, store_id, epcs_json, total_amount, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [pos_txn_id, store_id || null, JSON.stringify(normalized), total || 0.0, reason || null, now]
      );
    } catch (e) {
      // ignore if migration not run
    }

    // update cache & publish event
    try {
      normalized.forEach(e => {
        const key = `tag:${e}:status`;
        cache.set(key, JSON.stringify({ status: 'RETURNED' }), 'EX', 300).catch(()=>{});
      });
      rabbit.publish('pos_events', { type: 'POS_REFUND', pos_txn_id, store_id, epcs: normalized, total, reason }).catch(()=>{});
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : err }, 'pos/refund cache/publish failed');
    }

    return res.json({ ok: true, refunded: normalized.length, pos_txn_id });
  } catch (err) {
    logger.error({ err: err && err.message ? err.message : err }, 'pos/refund error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
