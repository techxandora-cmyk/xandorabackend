#!/usr/bin/env node

require("dotenv").config();
const { Pool } = require("pg");
const {
  runRetentionSweep,
} = require("../src/jobs/dataRetention");

function buildPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "rfid",
  };
}

async function main() {
  const pool = new Pool(buildPgConfig());
  try {
    const summary = await runRetentionSweep(pool, {
      dryRun: process.argv.includes("--apply") ? false : true,
    });
    console.log(JSON.stringify({ ok: true, retention: summary }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err && err.message ? err.message : String(err),
      },
      null,
      2
    )
  );
  process.exit(1);
});
