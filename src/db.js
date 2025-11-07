// src/db.js
// Central MySQL pool used by the API routes

const mysql = require('mysql2/promise');
require('dotenv').config();

const {
  MYSQL_HOST = '127.0.0.1',
  MYSQL_PORT = 3306,
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = 'rootpass',
  MYSQL_DATABASE = 'middleware_db',
} = process.env;

const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  connectionLimit: 10,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function ping() {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows?.[0]?.ok === 1;
  } catch (e) {
    console.error('DB ping failed:', e.message);
    return false;
  }
}

module.exports = pool;
module.exports.ping = ping;
