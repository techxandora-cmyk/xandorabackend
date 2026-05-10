const fs = require("fs");
const path = require("path");

const {
  getMigrationsDir,
  listExpectedMigrations,
} = require("../config/migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function wasApplied(client, filename) {
  const result = await client.query(
    `SELECT 1 FROM schema_migrations WHERE filename = $1`,
    [filename]
  );
  return result.rowCount > 0;
}

async function applyPendingMigrations(client) {
  const migrationsDir = getMigrationsDir();
  const targets = listExpectedMigrations();
  const applied = [];

  if (!targets.length) {
    return applied;
  }

  await ensureMigrationsTable(client);

  for (const filename of targets) {
    if (await wasApplied(client, filename)) {
      continue;
    }

    const filePath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filePath, "utf8");

    if (!sql.trim()) {
      continue;
    }

    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename]
    );
    applied.push(filename);
  }

  return applied;
}

module.exports = {
  applyPendingMigrations,
  ensureMigrationsTable,
};
