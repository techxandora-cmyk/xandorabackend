const crypto = require("crypto");

// In-memory token cache to avoid a DB hit on every scan batch
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

function generateToken(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

async function lookupScanToken(pool, rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const cached = _cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  let row = null;
  try {
    const r = await pool.query(
      `SELECT id, token, token_type, company_name, store_id, is_active
       FROM scan_tokens WHERE token = $1 LIMIT 1`,
      [token]
    );
    row = r.rowCount ? r.rows[0] : null;
  } catch {
    return null;
  }

  _cache.set(token, { row, expiresAt: Date.now() + CACHE_TTL_MS });

  if (row?.id) {
    pool
      .query("UPDATE scan_tokens SET last_used_at = NOW() WHERE id = $1", [row.id])
      .catch(() => {});
  }

  return row;
}

async function generateStoreToken(client, { companyName, storeId, label }) {
  const existing = await client.query(
    `SELECT token FROM scan_tokens
     WHERE token_type = 'store' AND company_name = $1 AND store_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [companyName, storeId]
  );
  if (existing.rows[0]?.token) return existing.rows[0].token;

  const token = generateToken("st");
  await client.query(
    `INSERT INTO scan_tokens (token, token_type, company_name, store_id, label)
     VALUES ($1, 'store', $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [token, companyName, storeId, label || storeId]
  );
  // Return the token that is now active for this store (may be pre-existing)
  const r = await client.query(
    `SELECT token FROM scan_tokens
     WHERE token_type = 'store' AND company_name = $1 AND store_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [companyName, storeId]
  );
  return r.rows[0]?.token || token;
}

async function generateCompanyToken(client, { companyName }) {
  const existing = await client.query(
    `SELECT token FROM scan_tokens
     WHERE token_type = 'company' AND company_name = $1 AND is_active = TRUE
     LIMIT 1`,
    [companyName]
  );
  if (existing.rows[0]?.token) return existing.rows[0].token;

  const token = generateToken("ct");
  await client.query(
    `INSERT INTO scan_tokens (token, token_type, company_name, store_id, label)
     VALUES ($1, 'company', $2, NULL, $2)
     ON CONFLICT DO NOTHING`,
    [token, companyName]
  );
  const r = await client.query(
    `SELECT token FROM scan_tokens
     WHERE token_type = 'company' AND company_name = $1 AND is_active = TRUE
     LIMIT 1`,
    [companyName]
  );
  return r.rows[0]?.token || token;
}

function invalidateCacheForToken(token) {
  _cache.delete(token);
}

module.exports = {
  generateToken,
  lookupScanToken,
  generateStoreToken,
  generateCompanyToken,
  invalidateCacheForToken,
};
