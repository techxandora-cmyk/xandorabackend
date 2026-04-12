let catalogReady = false;
let catalogReadyPromise = null;

async function ensureCatalogTable(pool) {
  if (catalogReady) return;
  if (catalogReadyPromise) {
    await catalogReadyPromise;
    return;
  }

  catalogReadyPromise = (async () => {
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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_catalog_items_store
      ON catalog_items (store_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_catalog_items_epc
      ON catalog_items (epc)
    `);

    catalogReady = true;
  })();

  try {
    await catalogReadyPromise;
  } catch (err) {
    catalogReadyPromise = null;
    throw err;
  }
}

module.exports = {
  ensureCatalogTable,
};
