// scripts/create_database.js
// Run with: node scripts/create_database.js

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  try {
    // Load connection info from .env
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL not found in .env");
    }

    const u = new URL(url);

    const host = u.hostname;
    const port = u.port ? Number(u.port) : 5432;
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    const targetDb = u.pathname.replace('/', '');

    console.log("Target DB:", targetDb);

    // Connect to maintenance DB "postgres"
    const adminPool = new Pool({
      host,
      port,
      user,
      password: pass,
      database: 'postgres'
    });

    console.log("Connecting to postgres...");
    await adminPool.query("SELECT 1");

    console.log("Attempting to create database:", targetDb);
    try {
      await adminPool.query(`CREATE DATABASE "${targetDb}"`);
      console.log("Database created:", targetDb);
    } catch (err) {
      if (err.code === '42P04') {
        console.log("Database already exists:", targetDb);
      } else {
        throw err;
      }
    }

    await adminPool.end();
    console.log("Done. Now run admin bootstrap.");

  } catch (err) {
    console.error("ERROR creating DB:", err.message);
    console.error(err);
  }
}

main();
