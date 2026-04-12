const { randomUUID } = require("crypto");

let tagRegistryReady = false;
let tagRegistryReadyPromise = null;

function normalizeTagValue(value) {
  const next = String(value || "").trim().toUpperCase();
  return next || null;
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function hasMasterRole(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.includes("MASTER_ADMIN");
}

function canExposeInternalUid(user, requested) {
  return hasMasterRole(user) && asBoolean(requested);
}

function sanitizeTagRegistryRow(row, options = {}) {
  if (!row) return null;

  const includeInternalUid = Boolean(options.includeInternalUid);
  const out = {
    epc: row.epc || null,
    tid: row.tid || null,
    store_id: row.store_id || null,
    company_name: row.company_name || null,
    source: row.source || null,
    created_by_user_id: row.created_by_user_id ?? null,
    created_by_email: row.created_by_email || null,
    metadata: row.metadata || {},
    first_seen_at: row.first_seen_at || null,
    last_seen_at: row.last_seen_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };

  if (includeInternalUid) {
    out.internal_uid = row.internal_uid || null;
    out.duplicate_of_internal_uid = row.duplicate_of_internal_uid || null;
  }

  return out;
}

async function ensureTagRegistryTable(pool) {
  if (tagRegistryReady) return;
  if (tagRegistryReadyPromise) {
    await tagRegistryReadyPromise;
    return;
  }

  tagRegistryReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tag_registry (
        id BIGSERIAL PRIMARY KEY,
        internal_uid UUID NOT NULL UNIQUE,
        epc VARCHAR(255) NOT NULL,
        tid VARCHAR(255),
        store_id VARCHAR(64),
        company_name TEXT,
        source TEXT NOT NULL DEFAULT 'MANUAL',
        duplicate_of_internal_uid UUID,
        created_by_user_id BIGINT,
        created_by_email TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tag_registry_epc
      ON tag_registry (epc)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tag_registry_tid
      ON tag_registry (tid)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tag_registry_store
      ON tag_registry (store_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tag_registry_created
      ON tag_registry (created_at DESC)
    `);

    tagRegistryReady = true;
  })();

  try {
    await tagRegistryReadyPromise;
  } catch (err) {
    tagRegistryReadyPromise = null;
    throw err;
  }
}

function classifyTagState(epcRows, tid) {
  if (!Array.isArray(epcRows) || epcRows.length === 0) {
    return {
      status: "NEW_TAG",
      action_required: false,
      allowed_actions: ["insert_as_new_tag"],
      exact: null,
      latest: null,
      duplicates: [],
      total_epc_rows: 0,
    };
  }

  const exact = epcRows.find((row) => {
    const rowTid = normalizeTagValue(row?.tid);
    return rowTid === tid;
  }) || null;

  const latest = epcRows[0] || null;
  const duplicates = exact
    ? epcRows.filter((row) => row.id !== exact.id)
    : epcRows;

  if (exact) {
    return {
      status: "EXISTS_EXACT",
      action_required: true,
      allowed_actions: ["already_available", "insert_as_new_tag"],
      exact,
      latest,
      duplicates,
      total_epc_rows: epcRows.length,
    };
  }

  return {
    status: "EPC_DUPLICATE",
    action_required: true,
    allowed_actions: ["already_available", "insert_as_new_tag"],
    exact: null,
    latest,
    duplicates,
    total_epc_rows: epcRows.length,
  };
}

async function loadTagRowsByEpc(pool, { epc, storeId, companyName, limit = 25 }) {
  const where = ["epc = $1"];
  const values = [epc];
  let i = 2;

  if (storeId) {
    where.push(`(store_id = $${i} OR store_id IS NULL)`);
    values.push(storeId);
    i += 1;
  }

  if (companyName) {
    where.push(`(company_name = $${i} OR company_name IS NULL)`);
    values.push(companyName);
    i += 1;
  }

  values.push(Math.max(Number(limit) || 25, 1));

  const r = await pool.query(
    `
    SELECT
      id,
      internal_uid,
      epc,
      tid,
      store_id,
      company_name,
      source,
      duplicate_of_internal_uid,
      created_by_user_id,
      created_by_email,
      metadata,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    FROM tag_registry
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${values.length}
    `,
    values
  );

  return r.rows || [];
}

async function touchTagRegistryRow(pool, id) {
  if (!id) return null;
  const r = await pool.query(
    `
    UPDATE tag_registry
    SET
      last_seen_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );
  return r.rows[0] || null;
}

async function insertTagRegistryRow(pool, payload = {}) {
  const internalUid = payload.internal_uid || randomUUID();
  const epc = normalizeTagValue(payload.epc);
  const tid = normalizeTagValue(payload.tid);

  if (!epc) {
    throw new Error("epc required");
  }

  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};

  const r = await pool.query(
    `
    INSERT INTO tag_registry (
      internal_uid,
      epc,
      tid,
      store_id,
      company_name,
      source,
      duplicate_of_internal_uid,
      created_by_user_id,
      created_by_email,
      metadata,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
      NOW(), NOW(), NOW(), NOW()
    )
    RETURNING *
    `,
    [
      internalUid,
      epc,
      tid,
      payload.store_id || null,
      payload.company_name || null,
      payload.source || "MANUAL_CONFIRM",
      payload.duplicate_of_internal_uid || null,
      payload.created_by_user_id || null,
      payload.created_by_email || null,
      JSON.stringify(metadata),
    ]
  );

  return r.rows[0] || null;
}

module.exports = {
  normalizeTagValue,
  asBoolean,
  hasMasterRole,
  canExposeInternalUid,
  sanitizeTagRegistryRow,
  ensureTagRegistryTable,
  classifyTagState,
  loadTagRowsByEpc,
  touchTagRegistryRow,
  insertTagRegistryRow,
};
