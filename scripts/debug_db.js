// scripts/debug_db.js
require('dotenv').config();
const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('Using DATABASE_URL:', (process.env.DATABASE_URL || '').replace(/:(.*?)@/, ':***@'));

    // Check connection
    try {
      await pool.query('SELECT 1');
      console.log('DB connection: OK');
    } catch (e) {
      console.error('DB connection failed:', e.message || e);
      await pool.end();
      process.exit(1);
    }

    // Tables existence & counts
    const checks = [
      { name: 'scan_items', q: "SELECT to_regclass('public.scan_items') IS NOT NULL AS exists" },
      { name: 'anomalies',  q: "SELECT to_regclass('public.anomalies') IS NOT NULL AS exists" },
      { name: 'devices',    q: "SELECT to_regclass('public.devices') IS NOT NULL AS exists" },
      { name: 'inventory_items', q: "SELECT to_regclass('public.inventory_items') IS NOT NULL AS exists" }
    ];

    for (const c of checks) {
      try {
        const r = (await pool.query(c.q)).rows[0];
        console.log(`${c.name} exists:`, !!r.exists);
      } catch (e) {
        console.log(`${c.name} exists: query failed ->`, e.message || e);
      }
    }

    // row counts
    async function safeCount(tbl) {
      try {
        const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tbl}`);
        return r.rows[0].c;
      } catch (e) {
        return `ERR: ${e.message}`;
      }
    }

    console.log('scan_items count:', await safeCount('scan_items'));
    console.log('anomalies count: ', await safeCount('anomalies'));
    console.log('devices count:   ', await safeCount('devices'));

    // show latest 10 scans
    try {
      const r = await pool.query(`SELECT id, tag, device_id, antenna_role, ts FROM scan_items ORDER BY ts DESC LIMIT 10`);
      console.log('Latest scans (up to 10):', r.rows);
    } catch (e) {
      console.log('Latest scans: query failed ->', e.message || e);
    }

    // show latest anomalies
    try {
      const r = await pool.query(`SELECT id, rule_code, tag, device_id, ts, details FROM anomalies ORDER BY ts DESC LIMIT 10`);
      console.log('Latest anomalies (up to 10):', r.rows);
    } catch (e) {
      console.log('Latest anomalies: query failed ->', e.message || e);
    }

    // show devices rows
    try {
      const r = await pool.query(`SELECT id, name, status, last_seen_at FROM devices ORDER BY last_seen_at DESC LIMIT 10`);
      console.log('Devices rows (up to 10):', r.rows);
    } catch (e) {
      console.log('Devices rows: query failed ->', e.message || e);
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Unhandled:', err);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
}

run();
