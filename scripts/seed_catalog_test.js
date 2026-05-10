/**
 * Seed catalog_items: 10 items (2 per category) mapped to real scanned EPCs.
 * Categories: T-Shirts, Shirts, Socks, Shoes, Pens
 * Stores: DEHIWALA_01 and STORE_001
 *
 * Usage: node scripts/seed_catalog_test.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STORES = ["DEHIWALA_01", "STORE_001"];

// 10 real EPCs from the Zebra RFD40 scanner — 2 items per category
const PRODUCTS = [
  // --- T-SHIRTS ---
  {
    epc: "E2806894000040232C613512",
    sku: "TSH-WHT-M",
    product_name: "Classic Crew T-Shirt",
    brand: "Northline",
    category: "T-Shirts",
    size_label: "M",
    color: "White",
    price_lkr: 1490.0,
  },
  {
    epc: "E2806894000040232C613518",
    sku: "TSH-BLK-L",
    product_name: "Classic Crew T-Shirt",
    brand: "Northline",
    category: "T-Shirts",
    size_label: "L",
    color: "Black",
    price_lkr: 1490.0,
  },

  // --- SHIRTS ---
  {
    epc: "E2806894000040232C61351B",
    sku: "SHT-BLU-M",
    product_name: "Oxford Button-Up Shirt",
    brand: "Northline",
    category: "Shirts",
    size_label: "M",
    color: "Blue",
    price_lkr: 2850.0,
  },
  {
    epc: "E2806894000040232C61351E",
    sku: "SHT-WHT-L",
    product_name: "Oxford Button-Up Shirt",
    brand: "Northline",
    category: "Shirts",
    size_label: "L",
    color: "White",
    price_lkr: 2850.0,
  },

  // --- SOCKS ---
  {
    epc: "E2806894000040232C613521",
    sku: "SOC-ANK-WHT",
    product_name: "Ankle Sports Socks",
    brand: "Northline",
    category: "Socks",
    size_label: "One Size",
    color: "White",
    price_lkr: 390.0,
  },
  {
    epc: "E2806894000040232C613522",
    sku: "SOC-CRW-BLK",
    product_name: "Crew Casual Socks",
    brand: "Northline",
    category: "Socks",
    size_label: "One Size",
    color: "Black",
    price_lkr: 450.0,
  },

  // --- SHOES ---
  {
    epc: "E2806894000040232C61351D",
    sku: "SHO-RUN-42",
    product_name: "EasyRun Training Shoe",
    brand: "Northline",
    category: "Shoes",
    size_label: "42",
    color: "White/Blue",
    price_lkr: 8950.0,
  },
  {
    epc: "E2806894000050232C61350E",
    sku: "SHO-CAS-41",
    product_name: "Urban Casual Sneaker",
    brand: "Northline",
    category: "Shoes",
    size_label: "41",
    color: "Black",
    price_lkr: 7200.0,
  },

  // --- PENS ---
  {
    epc: "E2806894000040232C613524",
    sku: "PEN-BALL-BLK",
    product_name: "Ballpoint Pen",
    brand: "Northline",
    category: "Pens",
    size_label: null,
    color: "Black",
    price_lkr: 120.0,
  },
  {
    epc: "E2806894000050232C613510",
    sku: "PEN-GEL-BLU",
    product_name: "Gel Ink Pen",
    brand: "Northline",
    category: "Pens",
    size_label: null,
    color: "Blue",
    price_lkr: 180.0,
  },
];

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id           BIGSERIAL PRIMARY KEY,
      store_id     VARCHAR(64) NOT NULL,
      epc          VARCHAR(255) NOT NULL,
      sku          VARCHAR(64),
      product_name VARCHAR(255) NOT NULL,
      brand        VARCHAR(128),
      category     VARCHAR(64),
      size_label   VARCHAR(32),
      color        VARCHAR(64),
      price_lkr    NUMERIC(12,2) NOT NULL DEFAULT 0,
      metadata     JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (store_id, epc)
    )
  `);

  // Clear out the old 25-item seed for these stores first
  await pool.query(
    `DELETE FROM catalog_items WHERE store_id = ANY($1::varchar[]) AND brand = 'Northline'`,
    [STORES]
  );

  let inserted = 0;

  for (const store_id of STORES) {
    for (const p of PRODUCTS) {
      await pool.query(
        `
        INSERT INTO catalog_items (
          store_id, epc, sku, product_name, brand, category,
          size_label, color, price_lkr
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (store_id, epc) DO UPDATE SET
          sku          = EXCLUDED.sku,
          product_name = EXCLUDED.product_name,
          brand        = EXCLUDED.brand,
          category     = EXCLUDED.category,
          size_label   = EXCLUDED.size_label,
          color        = EXCLUDED.color,
          price_lkr    = EXCLUDED.price_lkr,
          updated_at   = NOW()
        `,
        [
          store_id,
          p.epc,
          p.sku,
          p.product_name,
          p.brand,
          p.category,
          p.size_label,
          p.color,
          p.price_lkr,
        ]
      );
      inserted++;
    }
  }

  console.log(`\nDone. ${inserted} rows upserted across ${STORES.length} stores.\n`);

  const rows = await pool.query(
    `
    SELECT category, epc, product_name, brand, size_label, color, price_lkr
    FROM catalog_items
    WHERE store_id = $1
    ORDER BY category, sku
    `,
    [STORES[0]]
  );

  console.log(`Catalog for ${STORES[0]}:`);
  console.table(
    rows.rows.map((r) => ({
      category: r.category,
      product: r.product_name,
      brand: r.brand,
      size: r.size_label || "-",
      color: r.color,
      price: `LKR ${Number(r.price_lkr).toFixed(2)}`,
      epc: r.epc,
    }))
  );
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Seed failed:", err.message);
    pool.end();
    process.exit(1);
  });
