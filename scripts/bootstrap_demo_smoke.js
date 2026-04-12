#!/usr/bin/env node

require("dotenv").config();
const bcrypt = require("bcrypt");
const { Client } = require("pg");
const {
  ensureProductAccessTables,
  replaceCompanyProducts,
  replaceUserProducts,
} = require("../src/api/routes/lib/productAccess");
const { ensureCatalogTable } = require("../src/api/routes/lib/catalogTable");

const DEMO = {
  companyName: String(process.env.DEMO_COMPANY_NAME || "Xandora Demo Ops").trim(),
  adminEmail: String(process.env.DEMO_ADMIN_EMAIL || "demo.ops@xandora.local")
    .trim()
    .toLowerCase(),
  adminPassword: String(process.env.DEMO_ADMIN_PASSWORD || "DemoPass!123"),
  stores: [
    {
      store_id: String(process.env.DEMO_STORE_ID || "DEMO_MAIN")
        .trim()
        .toUpperCase(),
      store_name: String(process.env.DEMO_STORE_NAME || "Xandora Demo Main").trim(),
    },
    {
      store_id: String(process.env.DEMO_SECONDARY_STORE_ID || "DEMO_OUTLET")
        .trim()
        .toUpperCase(),
      store_name: String(
        process.env.DEMO_SECONDARY_STORE_NAME || "Xandora Demo Outlet"
      ).trim(),
    },
  ],
};

const DEMO_DEVICE_ROWS = [
  {
    device_id: "DEMO_READER_MAIN_01",
    name: "Demo Sales Floor Reader",
    store_id: "DEMO_MAIN",
    status: "online",
    last_seen: new Date().toISOString(),
    metadata: {
      section_profile: "SALES_FLOOR",
      zone_label: "Sales Floor",
      location: "Ground floor front",
      device_zones: {
        section_profile: "SALES_FLOOR",
      },
    },
  },
  {
    device_id: "DEMO_READER_OUTLET_01",
    name: "Demo Outlet Backroom Reader",
    store_id: "DEMO_OUTLET",
    status: "offline",
    last_seen: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    metadata: {
      section_profile: "BACKROOM",
      zone_label: "Backroom",
      location: "Outlet stock room",
      device_zones: {
        section_profile: "BACKROOM",
      },
    },
  },
];

const DEMO_CATALOG_ROWS = [
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0001",
    barcode: "DEMO-BOX-001",
    sku: "SKU-DEMO-TSHIRT-M",
    product_name: "Demo Crew Tee",
    brand: "Auraline",
    category: "TOPS",
    size_label: "M",
    color: "Black",
    price_lkr: 1890,
  },
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0002",
    barcode: "DEMO-BOX-001",
    sku: "SKU-DEMO-TSHIRT-M",
    product_name: "Demo Crew Tee",
    brand: "Auraline",
    category: "TOPS",
    size_label: "M",
    color: "Black",
    price_lkr: 1890,
  },
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0003",
    barcode: "DEMO-BOX-001",
    sku: "SKU-DEMO-TSHIRT-M",
    product_name: "Demo Crew Tee",
    brand: "Auraline",
    category: "TOPS",
    size_label: "M",
    color: "Black",
    price_lkr: 1890,
  },
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0004",
    barcode: "DEMO-BOX-001",
    sku: "SKU-DEMO-TSHIRT-M",
    product_name: "Demo Crew Tee",
    brand: "Auraline",
    category: "TOPS",
    size_label: "M",
    color: "Black",
    price_lkr: 1890,
  },
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0101",
    barcode: "DEMO-BOX-002",
    sku: "SKU-DEMO-DRESS-S",
    product_name: "Demo Shift Dress",
    brand: "Northline",
    category: "DRESSES",
    size_label: "S",
    color: "Cobalt",
    price_lkr: 3290,
  },
  {
    store_id: "DEMO_MAIN",
    epc: "DEMO-RET-0102",
    barcode: "DEMO-BOX-002",
    sku: "SKU-DEMO-DRESS-S",
    product_name: "Demo Shift Dress",
    brand: "Northline",
    category: "DRESSES",
    size_label: "S",
    color: "Cobalt",
    price_lkr: 3290,
  },
  {
    store_id: "DEMO_OUTLET",
    epc: "DEMO-RET-0201",
    barcode: "DEMO-BOX-003",
    sku: "SKU-DEMO-JEANS-32",
    product_name: "Demo Straight Jeans",
    brand: "Auraline",
    category: "BOTTOMS",
    size_label: "32",
    color: "Indigo",
    price_lkr: 4190,
  },
  {
    store_id: "DEMO_OUTLET",
    epc: "DEMO-RET-0202",
    barcode: "DEMO-BOX-003",
    sku: "SKU-DEMO-JEANS-32",
    product_name: "Demo Straight Jeans",
    brand: "Auraline",
    category: "BOTTOMS",
    size_label: "32",
    color: "Indigo",
    price_lkr: 4190,
  },
];

const DEMO_LAUNDRY_TYPES = [
  {
    code: "BED_SHEET_STD",
    name: "Bed Sheet",
    category: "LINEN",
    fabric_type: "Cotton",
    size_label: "Queen",
    unit_price: 2400,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
    notes: "Standard guest room bed sheet",
  },
  {
    code: "BATH_TOWEL_STD",
    name: "Bath Towel",
    category: "TOWEL",
    fabric_type: "Cotton",
    size_label: "Large",
    unit_price: 1450,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
    notes: "Standard bath towel",
  },
];

const DEMO_LAUNDRY_ITEMS = [
  {
    epc: "DEMO-LAU-OUT-001",
    type_code: "BED_SHEET_STD",
    item_name: "Guest Sheet 101",
    item_category: "LINEN",
    fabric_type: "Cotton",
    size_label: "Queen",
    unit_price: 2400,
    status: "OUT_WITH_CUSTOMER",
    current_location: "Villa 101",
    assigned_to: "Villa 101",
    wash_cycle_count: 12,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
  {
    epc: "DEMO-LAU-IN-001",
    type_code: "BATH_TOWEL_STD",
    item_name: "Spa Towel 01",
    item_category: "TOWEL",
    fabric_type: "Cotton",
    size_label: "Large",
    unit_price: 1450,
    status: "IN_STOCK",
    current_location: "Laundry stock",
    assigned_to: "",
    wash_cycle_count: 169,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
  {
    epc: "DEMO-LAU-WARN-170",
    type_code: "BED_SHEET_STD",
    item_name: "Lifecycle Sheet 170",
    item_category: "LINEN",
    fabric_type: "Cotton",
    size_label: "Queen",
    unit_price: 2400,
    status: "IN_STOCK",
    current_location: "Laundry stock",
    assigned_to: "",
    wash_cycle_count: 170,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
  {
    epc: "DEMO-LAU-WARN-190",
    type_code: "BED_SHEET_STD",
    item_name: "Lifecycle Sheet 190",
    item_category: "LINEN",
    fabric_type: "Cotton",
    size_label: "Queen",
    unit_price: 2400,
    status: "IN_STOCK",
    current_location: "Laundry stock",
    assigned_to: "",
    wash_cycle_count: 190,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
  {
    epc: "DEMO-LAU-WARN-195",
    type_code: "BED_SHEET_STD",
    item_name: "Lifecycle Sheet 195",
    item_category: "LINEN",
    fabric_type: "Cotton",
    size_label: "Queen",
    unit_price: 2400,
    status: "IN_STOCK",
    current_location: "Laundry stock",
    assigned_to: "",
    wash_cycle_count: 195,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
  {
    epc: "DEMO-LAU-DMG-001",
    type_code: "BATH_TOWEL_STD",
    item_name: "Replaceable Towel",
    item_category: "TOWEL",
    fabric_type: "Cotton",
    size_label: "Large",
    unit_price: 1450,
    status: "IN_STOCK",
    current_location: "Laundry stock",
    assigned_to: "",
    wash_cycle_count: 22,
    max_wash_cycles: 200,
    warning_cycle_threshold: 170,
  },
];

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
}

async function ensureLaundryTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS laundry_item_types (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'LINEN',
      fabric_type TEXT,
      size_label TEXT,
      unit_price NUMERIC(12,2),
      max_wash_cycles INT NOT NULL DEFAULT 200,
      warning_cycle_threshold INT NOT NULL DEFAULT 170,
      notes TEXT,
      created_by_user_id BIGINT,
      created_by_email TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_name, code)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS laundry_items (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      store_id VARCHAR(64) NOT NULL,
      epc VARCHAR(255) NOT NULL,
      item_type_id BIGINT REFERENCES laundry_item_types(id) ON DELETE SET NULL,
      item_code TEXT,
      item_name TEXT NOT NULL,
      item_category TEXT NOT NULL DEFAULT 'LINEN',
      fabric_type TEXT,
      size_label TEXT,
      unit_price NUMERIC(12,2),
      status TEXT NOT NULL DEFAULT 'IN_STOCK',
      current_location TEXT,
      assigned_to TEXT,
      wash_cycle_count INT NOT NULL DEFAULT 0,
      max_wash_cycles INT NOT NULL DEFAULT 200,
      warning_cycle_threshold INT NOT NULL DEFAULT 170,
      retired_at TIMESTAMPTZ,
      last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by_user_id BIGINT,
      created_by_email TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_name, epc)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS laundry_item_events (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      store_id VARCHAR(64) NOT NULL,
      item_id BIGINT NOT NULL REFERENCES laundry_items(id) ON DELETE CASCADE,
      epc VARCHAR(255) NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      cycle_increment INT NOT NULL DEFAULT 0,
      wash_cycle_after INT NOT NULL DEFAULT 0,
      location_label TEXT,
      assigned_to TEXT,
      reference_no TEXT,
      notes TEXT,
      actor_user_id BIGINT,
      actor_email TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

async function upsertCompanyStore(client, store, actorUserId) {
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
    [DEMO.companyName, store.store_id, store.store_name, actorUserId || null]
  );
}

async function ensureBaseRetailTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pos_transactions (
      id BIGSERIAL PRIMARY KEY,
      ext_id VARCHAR(128),
      total_amount NUMERIC(14,2) DEFAULT 0,
      total_items INT DEFAULT 0,
      store_id VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS pos_transaction_items (
      id BIGSERIAL PRIMARY KEY,
      pos_txn_id BIGINT NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
      epc VARCHAR(255) NOT NULL,
      price NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function cleanDemoScope(client, demoUserId) {
  const storeIds = DEMO.stores.map((store) => store.store_id);

  await client.query(
    `
    DELETE FROM alerts
    WHERE store_id = ANY($1::varchar[])
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM billing_session_scans
    WHERE session_id IN (
      SELECT id
      FROM billing_sessions
      WHERE store_id = ANY($1::varchar[])
    )
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM billing_sessions
    WHERE store_id = ANY($1::varchar[])
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM inventory_scans
    WHERE session_id IN (
      SELECT id
      FROM inventory_sessions
      WHERE store_id = ANY($1::varchar[])
    )
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM inventory_sessions
    WHERE store_id = ANY($1::varchar[])
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM pos_transaction_items
    WHERE pos_txn_id IN (
      SELECT id
      FROM pos_transactions
      WHERE store_id = ANY($1::varchar[])
        AND COALESCE(ext_id, '') LIKE 'DEMO-SMOKE-%'
    )
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM pos_transactions
    WHERE store_id = ANY($1::varchar[])
      AND COALESCE(ext_id, '') LIKE 'DEMO-SMOKE-%'
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM laundry_item_events
    WHERE company_name = $1
    `,
    [DEMO.companyName]
  );

  await client.query(
    `
    DELETE FROM laundry_items
    WHERE company_name = $1
    `,
    [DEMO.companyName]
  );

  await client.query(
    `
    DELETE FROM laundry_item_types
    WHERE company_name = $1
    `,
    [DEMO.companyName]
  );

  await client.query(
    `
    DELETE FROM catalog_items
    WHERE store_id = ANY($1::varchar[])
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM devices
    WHERE store_id = ANY($1::varchar[])
       OR device_id LIKE 'DEMO\\_%' ESCAPE '\\'
    `,
    [storeIds]
  );

  await client.query(
    `
    DELETE FROM user_store_roles
    WHERE user_id = $1
      AND (store_id = ANY($2::varchar[]) OR store_id = '_GLOBAL_')
    `,
    [demoUserId, storeIds]
  );
}

async function upsertDevice(client, row) {
  await client.query(
    `
    INSERT INTO devices (
      device_id,
      name,
      store_id,
      status,
      last_seen,
      metadata,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, NOW(), NOW())
    ON CONFLICT (device_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      store_id = EXCLUDED.store_id,
      status = EXCLUDED.status,
      last_seen = EXCLUDED.last_seen,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    `,
    [
      row.device_id,
      row.name,
      row.store_id,
      row.status,
      row.last_seen,
      JSON.stringify(row.metadata || {}),
    ]
  );
}

async function upsertCatalogItem(client, row) {
  await client.query(
    `
    INSERT INTO catalog_items (
      store_id,
      epc,
      sku,
      product_name,
      brand,
      category,
      size_label,
      color,
      price_lkr,
      metadata,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
    ON CONFLICT (store_id, epc)
    DO UPDATE SET
      sku = EXCLUDED.sku,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      category = EXCLUDED.category,
      size_label = EXCLUDED.size_label,
      color = EXCLUDED.color,
      price_lkr = EXCLUDED.price_lkr,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    `,
    [
      row.store_id,
      row.epc,
      row.sku,
      row.product_name,
      row.brand,
      row.category,
      row.size_label,
      row.color,
      row.price_lkr,
      JSON.stringify({ barcode: row.barcode }),
    ]
  );
}

async function upsertLaundryType(client, row, actor) {
  const result = await client.query(
    `
    INSERT INTO laundry_item_types (
      company_name,
      code,
      name,
      category,
      fabric_type,
      size_label,
      unit_price,
      max_wash_cycles,
      warning_cycle_threshold,
      notes,
      created_by_user_id,
      created_by_email,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb, NOW(), NOW()
    )
    ON CONFLICT (company_name, code)
    DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      fabric_type = EXCLUDED.fabric_type,
      size_label = EXCLUDED.size_label,
      unit_price = EXCLUDED.unit_price,
      max_wash_cycles = EXCLUDED.max_wash_cycles,
      warning_cycle_threshold = EXCLUDED.warning_cycle_threshold,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING id
    `,
    [
      DEMO.companyName,
      row.code,
      row.name,
      row.category,
      row.fabric_type,
      row.size_label,
      row.unit_price,
      row.max_wash_cycles,
      row.warning_cycle_threshold,
      row.notes || null,
      actor.user_id || null,
      actor.email || null,
    ]
  );

  return Number(result.rows[0].id);
}

async function upsertLaundryItem(client, row, itemTypeId, actor) {
  const result = await client.query(
    `
    INSERT INTO laundry_items (
      company_name,
      store_id,
      epc,
      item_type_id,
      item_code,
      item_name,
      item_category,
      fabric_type,
      size_label,
      unit_price,
      status,
      current_location,
      assigned_to,
      wash_cycle_count,
      max_wash_cycles,
      warning_cycle_threshold,
      last_event_at,
      created_by_user_id,
      created_by_email,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), $17, $18, '{}'::jsonb, NOW(), NOW()
    )
    ON CONFLICT (company_name, epc)
    DO UPDATE SET
      store_id = EXCLUDED.store_id,
      item_type_id = EXCLUDED.item_type_id,
      item_code = EXCLUDED.item_code,
      item_name = EXCLUDED.item_name,
      item_category = EXCLUDED.item_category,
      fabric_type = EXCLUDED.fabric_type,
      size_label = EXCLUDED.size_label,
      unit_price = EXCLUDED.unit_price,
      status = EXCLUDED.status,
      current_location = EXCLUDED.current_location,
      assigned_to = EXCLUDED.assigned_to,
      wash_cycle_count = EXCLUDED.wash_cycle_count,
      max_wash_cycles = EXCLUDED.max_wash_cycles,
      warning_cycle_threshold = EXCLUDED.warning_cycle_threshold,
      last_event_at = NOW(),
      updated_at = NOW()
    RETURNING id
    `,
    [
      DEMO.companyName,
      DEMO.stores[0].store_id,
      row.epc,
      itemTypeId,
      row.type_code,
      row.item_name,
      row.item_category,
      row.fabric_type || null,
      row.size_label || null,
      row.unit_price,
      row.status,
      row.current_location || null,
      row.assigned_to || null,
      row.wash_cycle_count,
      row.max_wash_cycles,
      row.warning_cycle_threshold,
      actor.user_id || null,
      actor.email || null,
    ]
  );

  return Number(result.rows[0].id);
}

async function seedLaundryRegisterEvents(client, itemsByEpc, actor) {
  for (const row of DEMO_LAUNDRY_ITEMS) {
    const itemId = itemsByEpc.get(row.epc);
    if (!itemId) continue;

    await client.query(
      `
      INSERT INTO laundry_item_events (
        company_name,
        store_id,
        item_id,
        epc,
        event_type,
        from_status,
        to_status,
        cycle_increment,
        wash_cycle_after,
        location_label,
        assigned_to,
        notes,
        actor_user_id,
        actor_email,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, 'REGISTERED', NULL, $5, 0, $6, $7, $8, $9, $10, $11, '{}'::jsonb
      )
      `,
      [
        DEMO.companyName,
        DEMO.stores[0].store_id,
        itemId,
        row.epc,
        row.status,
        row.wash_cycle_count,
        row.current_location || null,
        row.assigned_to || null,
        "Seeded for smoke testing",
        actor.user_id || null,
        actor.email || null,
      ]
    );
  }
}

async function seedRetailSale(client) {
  const sale = await client.query(
    `
    INSERT INTO pos_transactions (
      ext_id,
      total_amount,
      total_items,
      store_id,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id
    `,
    [
      "DEMO-SMOKE-SALE-001",
      1890,
      1,
      DEMO.stores[0].store_id,
      JSON.stringify({ txn_type: "SALE" }),
    ]
  );

  await client.query(
    `
    INSERT INTO pos_transaction_items (
      pos_txn_id,
      epc,
      price
    )
    VALUES ($1, $2, $3)
    `,
    [sale.rows[0].id, "DEMO-RET-0004", 1890]
  );
}

async function main() {
  const client = new Client(buildPgConfig());
  await client.connect();

  try {
    await client.query("BEGIN");
    await ensureProductAccessTables(client);
    await ensureCompanyStoresTable(client);
    await ensureCatalogTable(client);
    await ensureLaundryTables(client);
    await ensureBaseRetailTables(client);

    const demoUserId = await upsertUser(client, {
      email: DEMO.adminEmail,
      password: DEMO.adminPassword,
      companyName: DEMO.companyName,
    });

    await cleanDemoScope(client, demoUserId);

    for (const store of DEMO.stores) {
      await upsertCompanyStore(client, store, demoUserId);
      await ensureRole(client, demoUserId, store.store_id, "ADMIN");
    }

    await replaceCompanyProducts(client, DEMO.companyName, [
      "retail",
      "laundry",
      "stock_audit",
    ], {
      user_id: demoUserId,
      email: DEMO.adminEmail,
    });

    await replaceUserProducts(
      client,
      demoUserId,
      ["retail", "laundry", "stock_audit"],
      {
        user_id: demoUserId,
        email: DEMO.adminEmail,
      }
    );

    for (const row of DEMO_DEVICE_ROWS) {
      await upsertDevice(client, row);
    }

    for (const row of DEMO_CATALOG_ROWS) {
      await upsertCatalogItem(client, row);
    }

    const laundryTypeIds = new Map();
    for (const row of DEMO_LAUNDRY_TYPES) {
      const itemTypeId = await upsertLaundryType(client, row, {
        user_id: demoUserId,
        email: DEMO.adminEmail,
      });
      laundryTypeIds.set(row.code, itemTypeId);
    }

    const laundryItemIds = new Map();
    for (const row of DEMO_LAUNDRY_ITEMS) {
      const itemTypeId = laundryTypeIds.get(row.type_code);
      if (!itemTypeId) {
        throw new Error(`Missing laundry item type for ${row.type_code}`);
      }
      const itemId = await upsertLaundryItem(
        client,
        row,
        itemTypeId,
        {
          user_id: demoUserId,
          email: DEMO.adminEmail,
        }
      );
      laundryItemIds.set(row.epc, itemId);
    }

    await seedLaundryRegisterEvents(client, laundryItemIds, {
      user_id: demoUserId,
      email: DEMO.adminEmail,
    });
    await seedRetailSale(client);

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          demo: {
            company_name: DEMO.companyName,
            admin: {
              email: DEMO.adminEmail,
              password: DEMO.adminPassword,
            },
            stores: DEMO.stores,
            devices: DEMO_DEVICE_ROWS.map((row) => row.device_id),
            catalog_items: DEMO_CATALOG_ROWS.length,
            laundry_item_types: DEMO_LAUNDRY_TYPES.length,
            laundry_items: DEMO_LAUNDRY_ITEMS.length,
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
        error: err?.message || String(err),
      },
      null,
      2
    )
  );
  process.exit(1);
});
