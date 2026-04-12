let incidentCasesReady = false;
let incidentCasesReadyPromise = null;

const CASE_STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const CASE_PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const CASE_STATUS_SET = new Set(CASE_STATUS_OPTIONS);
const CASE_PRIORITY_SET = new Set(CASE_PRIORITY_OPTIONS);

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function isCaseStatus(value) {
  const key = String(value || "").trim().toUpperCase();
  return CASE_STATUS_SET.has(key);
}

function isCasePriority(value) {
  const key = String(value || "").trim().toUpperCase();
  return CASE_PRIORITY_SET.has(key);
}

function normalizeCaseStatus(value, fallback = "OPEN") {
  const key = String(value || "")
    .trim()
    .toUpperCase();
  if (CASE_STATUS_SET.has(key)) return key;
  return CASE_STATUS_SET.has(String(fallback || "").toUpperCase())
    ? String(fallback).toUpperCase()
    : "OPEN";
}

function normalizeCasePriority(value, fallback = "MEDIUM") {
  const key = String(value || "")
    .trim()
    .toUpperCase();
  if (CASE_PRIORITY_SET.has(key)) return key;
  return CASE_PRIORITY_SET.has(String(fallback || "").toUpperCase())
    ? String(fallback).toUpperCase()
    : "MEDIUM";
}

function normalizeOptionalText(value, maxLen = 4000) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function normalizeRequiredText(value, maxLen = 240) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function buildCaseRef(caseId, at = new Date()) {
  const id = Number(caseId) || 0;
  const day = at.toISOString().slice(0, 10).replace(/-/g, "");
  const serial = String(id).padStart(6, "0");
  return `CASE-${day}-${serial}`;
}

function sanitizeCaseRow(row) {
  if (!row) return null;
  return {
    ...row,
    status: normalizeCaseStatus(row.status),
    priority: normalizeCasePriority(row.priority),
    metadata: asObject(row.metadata),
    alert_metadata: asObject(row.alert_metadata),
  };
}

async function ensureIncidentCaseTables(pool) {
  if (incidentCasesReady) return;
  if (incidentCasesReadyPromise) {
    await incidentCasesReadyPromise;
    return;
  }

  incidentCasesReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_cases (
        id BIGSERIAL PRIMARY KEY,
        case_ref TEXT UNIQUE,
        alert_id BIGINT REFERENCES alerts(id) ON DELETE SET NULL,
        store_id VARCHAR(64) NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN'
          CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
        priority TEXT NOT NULL DEFAULT 'MEDIUM'
          CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
        title TEXT NOT NULL,
        description TEXT,
        assigned_to_user_id BIGINT,
        assigned_to_email TEXT,
        assigned_to_name TEXT,
        created_by_user_id BIGINT,
        created_by_email TEXT,
        resolution_notes TEXT,
        resolved_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE alert_cases
      ADD COLUMN IF NOT EXISTS case_ref TEXT
    `);
    await pool.query(`
      ALTER TABLE alert_cases
      ADD COLUMN IF NOT EXISTS assigned_to_name TEXT
    `);
    await pool.query(`
      ALTER TABLE alert_cases
      ADD COLUMN IF NOT EXISTS resolution_notes TEXT
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_alert_cases_case_ref
      ON alert_cases (case_ref)
      WHERE case_ref IS NOT NULL
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_cases_store_status_updated
      ON alert_cases (store_id, status, updated_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_cases_alert_id
      ON alert_cases (alert_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_cases_priority_status
      ON alert_cases (priority, status, updated_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_case_events (
        id BIGSERIAL PRIMARY KEY,
        case_id BIGINT NOT NULL REFERENCES alert_cases(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        note TEXT,
        actor_user_id BIGINT,
        actor_email TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE alert_case_events
      ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_case_events_case_id_created
      ON alert_case_events (case_id, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_case_events_event_type
      ON alert_case_events (event_type, created_at DESC)
    `);

    incidentCasesReady = true;
  })();

  try {
    await incidentCasesReadyPromise;
  } finally {
    incidentCasesReadyPromise = null;
  }
}

module.exports = {
  CASE_STATUS_OPTIONS,
  CASE_PRIORITY_OPTIONS,
  isCaseStatus,
  isCasePriority,
  normalizeCaseStatus,
  normalizeCasePriority,
  normalizeOptionalText,
  normalizeRequiredText,
  buildCaseRef,
  sanitizeCaseRow,
  ensureIncidentCaseTables,
};
