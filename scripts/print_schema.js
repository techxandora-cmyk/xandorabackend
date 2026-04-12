// scripts/print_schema.js
// Run from project root: node scripts/print_schema.js

(async () => {
  try {
    // adjust the path if your db module is elsewhere
    const db = require("../src/db");

    // helper to run a query and print table description
    async function describe(table) {
      try {
        const rows = await db.query(`DESCRIBE \`${table}\``);
        console.log("\n=== DESCRIBE", table, "===\n");
        console.table(rows);
      } catch (e) {
        console.warn(`Could not DESCRIBE ${table}:`, e.message);
      }
    }

    // get list of tables
    try {
      const res = await db.query("SHOW TABLES");
      console.log("\n=== TABLES ===\n");
      console.log(res);
    } catch (e) {
      console.warn("SHOW TABLES failed:", e.message);
    }

    // list of tables we care about (add/remove as needed)
    const want = ["scan_items", "devices", "pos_confirmed", "tags", "tag_events"];
    for (const t of want) {
      await describe(t);
    }

    // close pool/connection gracefully if your db module exposes end()
    if (typeof db.end === "function") {
      try { await db.end(); } catch(e) {}
    }
    process.exit(0);
  } catch (err) {
    console.error("Error running script:", err);
    process.exit(1);
  }
})();
