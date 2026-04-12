#!/usr/bin/env node

require("dotenv").config();
const bcrypt = require("bcrypt");
const { Client } = require("pg");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function getPgConfig() {
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
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  const password = String(
    args.password || process.env.BOOTSTRAP_ADMIN_PASSWORD || ""
  );
  const companyName = String(args.company || "Zyro").trim() || "Zyro";
  const defaultStore = String(args.store || "STORE_001").trim().toUpperCase();

  if (!email || !email.includes("@")) {
    throw new Error("Provide --email <admin@email>");
  }
  if (!password || password.length < 8) {
    throw new Error("Provide --password with at least 8 characters");
  }

  const client = new Client(getPgConfig());
  await client.connect();

  try {
    await client.query("BEGIN");

    const hash = await bcrypt.hash(password, 10);

    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    let userId;
    if (existing.rowCount) {
      userId = existing.rows[0].id;
      await client.query(
        `
        UPDATE users
        SET password_hash = $2,
            company_name = $3,
            is_active = TRUE
        WHERE id = $1
        `,
        [userId, hash, companyName]
      );
    } else {
      const insert = await client.query(
        `
        INSERT INTO users (email, password_hash, company_name, is_active)
        VALUES ($1, $2, $3, TRUE)
        RETURNING id
        `,
        [email, hash, companyName]
      );
      userId = insert.rows[0].id;
    }

    await client.query(
      `
      INSERT INTO user_store_roles (user_id, store_id, role)
      VALUES ($1, '_GLOBAL_', 'MASTER_ADMIN')
      ON CONFLICT DO NOTHING
      `,
      [userId]
    );

    if (defaultStore) {
      await client.query(
        `
        INSERT INTO user_store_roles (user_id, store_id, role)
        VALUES ($1, $2, 'MASTER_ADMIN')
        ON CONFLICT DO NOTHING
        `,
        [userId, defaultStore]
      );
    }

    await client.query("COMMIT");
    console.log(
      `[bootstrap] master admin ready: ${email} (company=${companyName}, store=${defaultStore})`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[bootstrap] failed: ${err.message}`);
  process.exit(1);
});
