require("dotenv").config();
const db = require("./src/db");

(async () => {
  try {
    const sql = `
      SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
    `;

    const [rows] = await db.query(sql);
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error("ERR:", err.message);
    process.exit(1);
  }
})();
