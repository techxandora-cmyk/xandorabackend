const SOFTWARE_CATALOG = [
  {
    key: "portal",
    label: "Xandora Admin Portal",
    company_assignable: false,
    user_assignable: true,
  },
  {
    key: "retail",
    label: "Xandora Retail",
    company_assignable: true,
    user_assignable: true,
  },
  {
    key: "laundry",
    label: "Xandora Laundry",
    company_assignable: true,
    user_assignable: true,
  },
  {
    key: "stock_audit",
    label: "Xandora Stock Audit",
    company_assignable: true,
    user_assignable: true,
  },
];

const COMPANY_ASSIGNABLE_PRODUCTS = SOFTWARE_CATALOG
  .filter((item) => item.company_assignable)
  .map((item) => item.key);

const USER_ASSIGNABLE_PRODUCTS = SOFTWARE_CATALOG.map((item) => item.key);

function normalizeProductKey(rawValue) {
  let value = String(rawValue || "").trim().toLowerCase();
  if (value === "jewellery" || value === "jewelry") {
    value = "stock_audit";
  }
  return USER_ASSIGNABLE_PRODUCTS.includes(value) ? value : "";
}

function normalizeProductKeys(rawValues, { companyAssignableOnly = false } = {}) {
  const source = Array.isArray(rawValues) ? rawValues : [];
  const allowed = companyAssignableOnly
    ? COMPANY_ASSIGNABLE_PRODUCTS
    : USER_ASSIGNABLE_PRODUCTS;

  return Array.from(
    new Set(
      source
        .map((value) => normalizeProductKey(value))
        .filter((value) => allowed.includes(value))
    )
  );
}

async function ensureProductAccessTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS company_products (
      company_name TEXT NOT NULL,
      product_key TEXT NOT NULL
        CHECK (product_key IN ('retail', 'laundry', 'stock_audit')),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT,
      created_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_name, product_key)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_company_products_company
    ON company_products (company_name, is_enabled)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_products (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_key TEXT NOT NULL
        CHECK (product_key IN ('portal', 'retail', 'laundry', 'stock_audit')),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT,
      created_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_key)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_products_product
    ON user_products (product_key, is_enabled)
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'set_updated_at'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'company_products_set_updated_at'
        ) THEN
          CREATE TRIGGER company_products_set_updated_at
          BEFORE UPDATE ON company_products
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'user_products_set_updated_at'
        ) THEN
          CREATE TRIGGER user_products_set_updated_at
          BEFORE UPDATE ON user_products
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at();
        END IF;
      END IF;
    END;
    $$;
  `);
}

async function getEnabledCompanyProducts(client, companyName) {
  const normalizedCompanyName = String(companyName || "").trim();
  if (!normalizedCompanyName) return [];

  const result = await client.query(
    `
    SELECT product_key
    FROM company_products
    WHERE company_name = $1
      AND is_enabled = TRUE
    ORDER BY product_key ASC
    `,
    [normalizedCompanyName]
  );

  return result.rows
    .map((row) => normalizeProductKey(row.product_key))
    .filter(Boolean);
}

async function getEnabledUserProducts(client, userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return [];

  const result = await client.query(
    `
    SELECT product_key
    FROM user_products
    WHERE user_id = $1
      AND is_enabled = TRUE
    ORDER BY product_key ASC
    `,
    [normalizedUserId]
  );

  return result.rows
    .map((row) => normalizeProductKey(row.product_key))
    .filter(Boolean);
}

async function getEnabledUserProductMap(client, userIds) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );

  if (!normalizedIds.length) return {};

  const result = await client.query(
    `
    SELECT user_id, product_key
    FROM user_products
    WHERE user_id = ANY($1::bigint[])
      AND is_enabled = TRUE
    ORDER BY user_id ASC, product_key ASC
    `,
    [normalizedIds]
  );

  const out = {};
  for (const userId of normalizedIds) {
    out[userId] = [];
  }

  for (const row of result.rows) {
    const userId = Number(row.user_id);
    const productKey = normalizeProductKey(row.product_key);
    if (!productKey) continue;
    if (!Array.isArray(out[userId])) out[userId] = [];
    out[userId].push(productKey);
  }

  return out;
}

async function replaceCompanyProducts(
  client,
  companyName,
  productKeys,
  actor = {}
) {
  const normalizedCompanyName = String(companyName || "").trim();
  const nextKeys = normalizeProductKeys(productKeys, {
    companyAssignableOnly: true,
  });

  await client.query(
    `
    DELETE FROM company_products
    WHERE company_name = $1
      AND product_key <> ALL($2::text[])
    `,
    [normalizedCompanyName, nextKeys.length ? nextKeys : ["__NONE__"]]
  );

  for (const productKey of nextKeys) {
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
      [
        normalizedCompanyName,
        productKey,
        actor.user_id || null,
        actor.email || null,
      ]
    );
  }

  return nextKeys;
}

async function replaceUserProducts(client, userId, productKeys, actor = {}) {
  const normalizedUserId = Number(userId);
  const nextKeys = normalizeProductKeys(productKeys);

  await client.query(
    `
    DELETE FROM user_products
    WHERE user_id = $1
      AND product_key <> ALL($2::text[])
    `,
    [normalizedUserId, nextKeys.length ? nextKeys : ["__NONE__"]]
  );

  for (const productKey of nextKeys) {
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
      [
        normalizedUserId,
        productKey,
        actor.user_id || null,
        actor.email || null,
      ]
    );
  }

  return nextKeys;
}

module.exports = {
  SOFTWARE_CATALOG,
  COMPANY_ASSIGNABLE_PRODUCTS,
  USER_ASSIGNABLE_PRODUCTS,
  normalizeProductKey,
  normalizeProductKeys,
  ensureProductAccessTables,
  getEnabledCompanyProducts,
  getEnabledUserProducts,
  getEnabledUserProductMap,
  replaceCompanyProducts,
  replaceUserProducts,
};
