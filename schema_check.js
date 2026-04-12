const db = require("./src/db");

async function run() {
  try {
    console.log("\n=== DEVICES ===");
    let [rows] = await db.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'devices'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(rows);

    console.log("\n=== SCAN_ITEMS ===");
    let [rows2] = await db.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'scan_items'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(rows2);

    process.exit(0);
  } catch (e) {
    console.error("ERR:", e.message);
    process.exit(1);
  }
}

run();
