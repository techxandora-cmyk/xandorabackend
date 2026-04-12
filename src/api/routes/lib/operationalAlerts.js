function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

async function upsertOperationalAlert(db, input = {}) {
  const type = String(input.type || "").trim().toUpperCase();
  const entityType = String(input.entity_type || "SESSION").trim().toUpperCase();
  const entityId = String(input.entity_id || "").trim();
  const storeId = input.store_id ? String(input.store_id).trim() : null;
  const severity = Math.min(Math.max(Number(input.severity || 50), 1), 100);
  const metadata = asObject(input.metadata);

  if (!type || !entityId) return null;

  const existing = await db.query(
    `
    SELECT id
    FROM alerts
    WHERE type = $1
      AND entity_type = $2
      AND entity_id = $3
      AND (store_id IS NOT DISTINCT FROM $4::varchar)
      AND status = 'OPEN'
    ORDER BY id DESC
    LIMIT 1
    `,
    [type, entityType, entityId, storeId]
  );

  if (existing.rowCount > 0) {
    const updated = await db.query(
      `
      UPDATE alerts
      SET
        severity = GREATEST(severity, $2::int),
        metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
        last_detected_at = NOW(),
        resolved_at = NULL,
        status = 'OPEN',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [existing.rows[0].id, severity, JSON.stringify(metadata)]
    );
    return updated.rows[0] || null;
  }

  const inserted = await db.query(
    `
    INSERT INTO alerts (
      type,
      entity_type,
      entity_id,
      store_id,
      severity,
      status,
      metadata,
      first_detected_at,
      last_detected_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'OPEN', $6::jsonb, NOW(), NOW(), NOW())
    RETURNING *
    `,
    [type, entityType, entityId, storeId, severity, JSON.stringify(metadata)]
  );

  return inserted.rows[0] || null;
}

async function resolveOperationalAlert(db, input = {}) {
  const type = String(input.type || "").trim().toUpperCase();
  const entityType = String(input.entity_type || "SESSION").trim().toUpperCase();
  const entityId = String(input.entity_id || "").trim();
  const storeId = input.store_id ? String(input.store_id).trim() : null;
  const metadata = asObject(input.metadata);

  if (!type || !entityId) return null;

  const updated = await db.query(
    `
    UPDATE alerts
    SET
      status = 'RESOLVED',
      resolved_at = NOW(),
      last_detected_at = NOW(),
      metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
      updated_at = NOW()
    WHERE type = $1
      AND entity_type = $2
      AND entity_id = $3
      AND (store_id IS NOT DISTINCT FROM $4::varchar)
      AND status = 'OPEN'
    RETURNING *
    `,
    [type, entityType, entityId, storeId, JSON.stringify(metadata)]
  );

  return updated.rows[0] || null;
}

module.exports = {
  resolveOperationalAlert,
  upsertOperationalAlert,
};
