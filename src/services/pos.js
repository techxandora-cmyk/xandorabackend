// src/services/pos.js
const pool = require("../services/db");
const bus = require("../services/bus");

/**
 * Upsert/insert POS transactions in bulk.
 * payload = { sales: [{ext_id, store_id, items_count, amount, ts}] }
 *
 * Assumes there is a UNIQUE index on ext_id (uniq_pos_ext) so duplicates are ignored.
 */
async function insertSales(sales = []) {
  if (!Array.isArray(sales) || sales.length === 0) return { inserted: 0 };

  // Normalize & validate
  const rows = sales.map((s) => ({
    ext_id: s.ext_id ?? null,
    store_id: String(s.store_id || "").trim(),
    items_count: Number(s.items_count || 0),
    amount: Number(s.amount || 0),
    ts: new Date(s.ts || Date.now()),
  })).filter(r => r.store_id);

  if (rows.length === 0) return { inserted: 0 };

  // Use INSERT IGNORE to respect UNIQUE(ext_id)
  const sql = `
    INSERT IGNORE INTO pos_transactions (ext_id, store_id, items_count, amount, ts)
    VALUES ?
  `;
  const values = rows.map(r => [r.ext_id, r.store_id, r.items_count, r.amount, r.ts]);

  const [res] = await pool.query(sql, [values]);
  const inserted = res.affectedRows || 0;

  // Notify listeners (SSE) so dashboard can refresh immediately
  if (inserted > 0) {
    bus.emit('pos_changed', { inserted, at: Date.now() });
  }

  return { inserted };
}

module.exports = { insertSales };
