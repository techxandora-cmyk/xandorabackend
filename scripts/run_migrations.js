// scripts/run_migrations.js
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const sql = fs.readFileSync('migrations/001_init.sql', 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'rootpass',
    multipleStatements: true
  });
  await conn.query(sql);
  console.log('✅ migrations applied');
  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
