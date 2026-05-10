const { Client } = require("pg");
require("dotenv").config();

const { listExpectedMigrations } = require("../src/config/migrations");
const { applyPendingMigrations } = require("../src/services/dbMigrations");

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
  const targets = listExpectedMigrations();
  if (!targets.length) {
    console.log("No PostgreSQL migrations found.");
    return;
  }

  const client = new Client(buildPgConfig());
  await client.connect();

  try {
    const applied = await applyPendingMigrations(client);
    if (!applied.length) {
      console.log("No pending PostgreSQL migrations.");
    } else {
      for (const filename of applied) {
        console.log(`Applied ${filename}`);
      }
    }
    console.log("PostgreSQL migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err.message);
  process.exit(1);
});
