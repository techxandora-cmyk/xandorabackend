// src/services/scans.js
const pool = require("./db");

/**
 * Insert a batch of tag scans into scan_items.
 * De-duplicates by UNIQUE(device_id, tag, ts).
 * payload: { device_id, store_id?, items: [{ tag, ts }] }
 */
async function insertScanBatch(payload = {}) {
  const device_id = String(payload.device_id || "").trim();
  const store_id = payload.store_id ? String(payload.store_id).trim() : null;
  const batch_id = payload.batch_id ? String(payload.batch_id).trim() : null;
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!device_id || items.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // Normalize & validate
  const rows = [];
  for (const it of items) {
    const tag = String(it.tag || "").trim();
    const ts = it.ts ? new Date(it.ts) : new Date(); // fallback now
    if (!tag || Number.isNaN(ts.getTime())) continue;
    rows.push([batch_id, device_id, store_id, tag, ts]);
  }
  if (rows.length === 0) return { inserted: 0, skipped: items.length };

  // INSERT IGNORE to honor uniq_device_tag_ts
  const sql = `
    INSERT IGNORE INTO scan_items
      (batch_id, device_id, store_id, tag, ts)
    VALUES ?
  `;
  const [res] = await pool.query(sql, [rows]);
  const inserted = res.affectedRows || 0;
  const skipped = rows.length - inserted;
  return { inserted, skipped };
}

module.exports = { insertScanBatch };
