const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config();
const { getMigrationsDir, listExpectedMigrations } = require("../src/config/migrations");

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

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function wasApplied(client, filename) {
  const r = await client.query(
    `SELECT 1 FROM schema_migrations WHERE filename = $1`,
    [filename]
  );
  return r.rowCount > 0;
}

async function runFile(client, filePath) {
  const filename = path.basename(filePath);
  const sql = fs.readFileSync(filePath, "utf8");

  if (!sql.trim()) {
    console.log(`⏭ Skipping ${filename} (empty file)`);
    return;
  }

  if (await wasApplied(client, filename)) {
    console.log(`⏭ Skipping ${filename} (already applied)`);
    return;
  }

  console.log(`>>> Applying ${filename}`);
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename]
    );
    console.log(`✅ Applied ${filename}`);
  } catch (err) {
    throw new Error(`${filename}: ${err.message}`);
  }
}

async function main() {
  const migrationsDir = getMigrationsDir();
  const targets = listExpectedMigrations();
  if (!targets.length) {
    console.log("No PostgreSQL migrations found.");
    return;
  }

  const client = new Client(buildPgConfig());
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    for (const file of targets) {
      await runFile(client, path.join(migrationsDir, file));
    }
    console.log("🎉 PostgreSQL migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration runner failed:", err.message);
  process.exit(1);
});
