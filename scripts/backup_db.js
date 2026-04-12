#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

require("dotenv").config();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function getConnectionOptions() {
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

function canUsePgDump() {
  const probe = spawnSync("pg_dump", ["--version"], {
    stdio: "ignore",
    shell: false,
  });
  return probe.status === 0;
}

function runPgDump(targetFile) {
  const args = ["--format=custom", `--file=${targetFile}`];

  if (process.env.DATABASE_URL) {
    args.push(`--dbname=${process.env.DATABASE_URL}`);
  } else {
    args.push(`--host=${process.env.PGHOST || "127.0.0.1"}`);
    args.push(`--port=${process.env.PGPORT || "5432"}`);
    args.push(`--username=${process.env.PGUSER || "postgres"}`);
    args.push(process.env.PGDATABASE || "rfid");
  }

  const result = spawnSync("pg_dump", args, {
    env: {
      ...process.env,
      PGPASSWORD: process.env.PGPASSWORD || "postgres",
    },
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "pg_dump failed");
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function writeJsonSnapshot(targetFile) {
  const options = getConnectionOptions();
  const client = new Client(options);
  await client.connect();

  try {
    const tableRes = await client.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
      `
    );

    const tables = {};
    for (const row of tableRes.rows) {
      const tableName = row.table_name;
      const safeTable = quoteIdentifier(tableName);

      const columnsRes = await client.query(
        `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position
        `,
        [tableName]
      );

      const rowsRes = await client.query(`SELECT * FROM ${safeTable}`);
      tables[tableName] = {
        columns: columnsRes.rows,
        row_count: rowsRes.rowCount,
        rows: rowsRes.rows,
      };
    }

    const payload = {
      generated_at: new Date().toISOString(),
      database: {
        host: options.host || null,
        port: options.port || null,
        database: options.database || null,
        using_database_url: Boolean(options.connectionString),
      },
      tables,
    };

    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), "utf8");
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(process.cwd(), args.outdir || "backups");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");

  const prefix = path.join(outDir, `rfid_backup_${stamp}`);
  const files = [];

  if (canUsePgDump()) {
    const dumpPath = `${prefix}.dump`;
    try {
      runPgDump(dumpPath);
      files.push(dumpPath);
      console.log(`[backup] pg_dump written: ${dumpPath}`);
    } catch (err) {
      console.warn(`[backup] pg_dump failed: ${err.message}`);
    }
  } else {
    console.warn("[backup] pg_dump not found. Falling back to JSON snapshot.");
  }

  const jsonPath = `${prefix}.json`;
  await writeJsonSnapshot(jsonPath);
  files.push(jsonPath);
  console.log(`[backup] JSON snapshot written: ${jsonPath}`);

  if (!files.length) {
    throw new Error("No backup files were generated.");
  }

  console.log(`[backup] done. files=${files.length}`);
}

main().catch((err) => {
  console.error(`[backup] failed: ${err.message}`);
  process.exit(1);
});
