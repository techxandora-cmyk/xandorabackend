#!/usr/bin/env node

require("dotenv").config();
const bcrypt = require("bcrypt");
const { Client } = require("pg");
const {
  ensureProductAccessTables,
} = require("../src/api/routes/lib/productAccess");

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

async function ensureCompanyStoresTable(client) {
  await client.query(`
    CREATE SEQUENCE IF NOT EXISTS company_stores_id_seq
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS company_stores (
      id BIGINT PRIMARY KEY DEFAULT nextval('company_stores_id_seq'::regclass),
      company_name TEXT NOT NULL,
      store_id VARCHAR(64) NOT NULL,
      store_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_name, store_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_company_stores_company_name
    ON company_stores (company_name)
  `);
}

async function upsertUser(client, { email, password, companyName }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await client.query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );

  if (existing.rowCount) {
    const result = await client.query(
      `
      UPDATE users
      SET password_hash = $2,
          company_name = $3,
          is_active = TRUE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
      `,
      [existing.rows[0].id, passwordHash, companyName]
    );
    return Number(result.rows[0].id);
  }

  const inserted = await client.query(
    `
    INSERT INTO users (email, password_hash, company_name, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, TRUE, NOW(), NOW())
    RETURNING id
    `,
    [email, passwordHash, companyName]
  );
  return Number(inserted.rows[0].id);
}

async function ensureRole(client, userId, storeId, role) {
  await client.query(
    `
    INSERT INTO user_store_roles (user_id, store_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    `,
    [userId, storeId, role]
  );
}

async function ensureCompanyStore(client, {
  companyName,
  storeId,
  storeName,
  actorUserId,
}) {
  await client.query(
    `
    INSERT INTO company_stores (
      company_name,
      store_id,
      store_name,
      is_active,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, TRUE, $4, NOW(), NOW())
    ON CONFLICT (company_name, store_id)
    DO UPDATE SET
      store_name = EXCLUDED.store_name,
      is_active = TRUE,
      updated_at = NOW()
    `,
    [companyName, storeId, storeName, actorUserId || null]
  );
}

async function ensureCompanyProduct(client, companyName, productKey, actor) {
  await client.query(
    `
    INSERT INTO company_products (
      company_name,
      product_key,
      is_enabled,
      created_by_user_id,
      created_by_email,
      created_at,
      updated_at
    )
    VALUES ($1, $2, TRUE, $3, $4, NOW(), NOW())
    ON CONFLICT (company_name, product_key)
    DO UPDATE SET
      is_enabled = TRUE,
      updated_at = NOW(),
      created_by_user_id = EXCLUDED.created_by_user_id,
      created_by_email = EXCLUDED.created_by_email
    `,
    [companyName, productKey, actor.userId || null, actor.email || null]
  );
}

async function ensureUserProduct(client, userId, productKey, actor) {
  await client.query(
    `
    INSERT INTO user_products (
      user_id,
      product_key,
      is_enabled,
      created_by_user_id,
      created_by_email,
      created_at,
      updated_at
    )
    VALUES ($1, $2, TRUE, $3, $4, NOW(), NOW())
    ON CONFLICT (user_id, product_key)
    DO UPDATE SET
      is_enabled = TRUE,
      updated_at = NOW(),
      created_by_user_id = EXCLUDED.created_by_user_id,
      created_by_email = EXCLUDED.created_by_email
    `,
    [userId, productKey, actor.userId || null, actor.email || null]
  );
}

async function main() {
  const masterEmail = String(
    process.env.E2E_MASTER_ADMIN_EMAIL || "admin@xandora.local"
  )
    .trim()
    .toLowerCase();
  const masterPassword = String(
    process.env.E2E_MASTER_ADMIN_PASSWORD || "ChangeMe!123"
  );
  const masterCompany = String(process.env.E2E_MASTER_ADMIN_COMPANY || "XANDORA")
    .trim()
    .toUpperCase();

  const companyAdminEmail = String(
    process.env.E2E_COMPANY_ADMIN_EMAIL || "ops@northline-retail.local"
  )
    .trim()
    .toLowerCase();
  const companyAdminPassword = String(
    process.env.E2E_COMPANY_ADMIN_PASSWORD || "ChangeMe!123"
  );
  const companyName = String(
    process.env.E2E_COMPANY_NAME || "Northline Retail"
  ).trim();
  const storeId = String(process.env.E2E_STORE_ID || "NORTHLINE_001")
    .trim()
    .toUpperCase();
  const storeName = String(process.env.E2E_STORE_NAME || "Northline Flagship")
    .trim();

  const client = new Client(buildPgConfig());
  await client.connect();

  try {
    await client.query("BEGIN");
    await ensureProductAccessTables(client);
    await ensureCompanyStoresTable(client);

    const masterUserId = await upsertUser(client, {
      email: masterEmail,
      password: masterPassword,
      companyName: masterCompany,
    });
    await ensureRole(client, masterUserId, "_GLOBAL_", "MASTER_ADMIN");
    await ensureUserProduct(client, masterUserId, "portal", {
      userId: masterUserId,
      email: masterEmail,
    });

    const companyAdminUserId = await upsertUser(client, {
      email: companyAdminEmail,
      password: companyAdminPassword,
      companyName,
    });
    await ensureCompanyStore(client, {
      companyName,
      storeId,
      storeName,
      actorUserId: masterUserId,
    });
    await ensureRole(client, companyAdminUserId, storeId, "ADMIN");

    for (const productKey of ["retail", "stock_audit"]) {
      await ensureCompanyProduct(client, companyName, productKey, {
        userId: masterUserId,
        email: masterEmail,
      });
      await ensureUserProduct(client, companyAdminUserId, productKey, {
        userId: masterUserId,
        email: masterEmail,
      });
    }

    await ensureUserProduct(client, companyAdminUserId, "portal", {
      userId: masterUserId,
      email: masterEmail,
    });

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          accounts: {
            master_admin: {
              email: masterEmail,
            },
            company_admin: {
              email: companyAdminEmail,
              company_name: companyName,
              store_id: storeId,
            },
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
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
