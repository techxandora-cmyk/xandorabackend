// scripts/patch_scan_items.js
const db = require("../src/db");

async function colExists(table, col) {
  const sql = `
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1
  `;
  const [rows] = await db.query(sql, [table, col]);
  return rows && rows.length > 0;
}

async function indexExists(table, idx) {
  const sql = `
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1
  `;
  const [rows] = await db.query(sql, [table, idx]);
  return rows && rows.length > 0;
}

(async () => {
  try {
    console.log("Checking/adding columns on scan_items...");

    if (!await colExists('scan_items', 'raw')) {
      await db.query("ALTER TABLE scan_items ADD COLUMN raw JSON NULL");
      console.log("Added column: raw");
    } else console.log("raw exists");

    if (!await colExists('scan_items', 'rssi')) {
      await db.query("ALTER TABLE scan_items ADD COLUMN rssi INT NULL");
      console.log("Added column: rssi");
    } else console.log("rssi exists");

    if (!await colExists('scan_items', 'updated_at')) {
      await db.query("ALTER TABLE scan_items ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
      console.log("Added column: updated_at");
    } else console.log("updated_at exists");

    // remove duplicates (keep smallest id)
    console.log("Removing duplicate scan_items (if any)...");
    const dupCheckSql = `
      SELECT device_id, tag, ts, COUNT(*) AS cnt
      FROM scan_items
      GROUP BY device_id, tag, ts
      HAVING cnt > 1
      LIMIT 1
    `;
    const [dupRows] = await db.query(dupCheckSql);
    if (dupRows && dupRows.length) {
      console.log("Duplicates found — cleaning up (this may take time)...");
      const deleteSql = `
        DELETE si FROM scan_items si
        JOIN (
          SELECT device_id, tag, ts, MIN(id) AS keep_id
          FROM scan_items
          GROUP BY device_id, tag, ts
          HAVING COUNT(*) > 1
        ) dup ON si.device_id = dup.device_id AND si.tag = dup.tag AND si.ts = dup.ts
        WHERE si.id <> dup.keep_id
      `;
      await db.query(deleteSql);
      console.log("Duplicates removed");
    } else {
      console.log("No duplicates found");
    }

    // add unique index if missing
    if (!await indexExists('scan_items', 'ux_scan_unique')) {
      await db.query("ALTER TABLE scan_items ADD UNIQUE KEY ux_scan_unique (device_id, tag, ts)");
      console.log("Added unique index ux_scan_unique");
    } else {
      console.log("ux_scan_unique exists");
    }

    console.log("scan_items patch complete");
    process.exit(0);
  } catch (e) {
    console.error("Error patching scan_items:", e.message);
    process.exit(1);
  }
})();
