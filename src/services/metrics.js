const pool = require("../services/db");

async function tableExists(db, name) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.tables
     WHERE table_schema=? AND table_name=?`,
    [db, name]
  );
  return r?.[0]?.c > 0;
}

async function columnsOf(db, table) {
  const [r] = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=? AND table_name=?`,
    [db, table]
  );
  return new Set((r || []).map(x => x.column_name));
}

async function getDbName() {
  const [r] = await pool.query(`SELECT DATABASE() AS db`);
  return r?.[0]?.db || "middleware_db";
}

async function detectPosTable(db) {
  const name = "pos_transactions";
  return (await tableExists(db, name)) ? name : null;
}

async function detectScansTable(db) {
  const candidates = ["scans", "scan_events", "rfid_scans"];
  for (const t of candidates) {
    if (await tableExists(db, t)) {
      const cols = await columnsOf(db, t);
      if (cols.has("tag") && cols.has("ts")) return t;
    }
  }
  return null;
}

async function getSummary() {
  const db = await getDbName();
  const posTable = await detectPosTable(db);
  const scansTable = await detectScansTable(db);

  let total_sales_amount = 0;
  let total_pos_transactions = 0;
  let total_items_sold = 0;

  if (posTable) {
    const posCols = await columnsOf(db, posTable);

    // Transactions
    {
      const [r] = await pool.query(`SELECT COUNT(*) AS c FROM \`${posTable}\``);
      total_pos_transactions = r?.[0]?.c || 0;
    }

    // Sales amount — prefer total_amount, but fall back to amount if present
    if (posCols.has("total_amount") && posCols.has("amount")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(total_amount, amount, 0)),0) AS s
           FROM \`${posTable}\``
      );
      total_sales_amount = Number(r?.[0]?.s || 0);
    } else if (posCols.has("total_amount")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS s
           FROM \`${posTable}\``
      );
      total_sales_amount = Number(r?.[0]?.s || 0);
    } else if (posCols.has("amount")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS s
           FROM \`${posTable}\``
      );
      total_sales_amount = Number(r?.[0]?.s || 0);
    }

    // Items sold — prefer JSON items, but fall back to items_count if present
    if (posCols.has("items") && posCols.has("items_count")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(JSON_LENGTH(items), items_count, 0)),0) AS s
           FROM \`${posTable}\``
      );
      total_items_sold = Number(r?.[0]?.s || 0);
    } else if (posCols.has("items")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(JSON_LENGTH(items)),0) AS s
           FROM \`${posTable}\``
      );
      total_items_sold = Number(r?.[0]?.s || 0);
    } else if (posCols.has("items_count")) {
      const [r] = await pool.query(
        `SELECT COALESCE(SUM(items_count),0) AS s
           FROM \`${posTable}\``
      );
      total_items_sold = Number(r?.[0]?.s || 0);
    }
  }

  // Scans: COUNT DISTINCT tags
  let items_scanned_today = 0;
  let items_scanned_24h = 0;

  if (scansTable) {
    {
      const [r] = await pool.query(
        `SELECT COUNT(DISTINCT tag) AS c
           FROM \`${scansTable}\`
          WHERE DATE(ts) = CURRENT_DATE()`
      );
      items_scanned_today = r?.[0]?.c || 0;
    }
    {
      const [r] = await pool.query(
        `SELECT COUNT(DISTINCT tag) AS c
           FROM \`${scansTable}\`
          WHERE ts >= (NOW() - INTERVAL 1 DAY)`
      );
      items_scanned_24h = r?.[0]?.c || 0;
    }
  }

  return {
    total_sales_amount,
    total_pos_transactions,
    total_items_sold,
    items_scanned_today,
    items_scanned_24h,
    last_updated: new Date().toISOString(),
  };
}

module.exports = { getSummary };
