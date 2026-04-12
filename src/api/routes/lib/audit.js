async function writeAuditLog(
  pool,
  {
    actor_user_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    store_id = null,
    metadata = {}
  }
) {
  try {
    await pool.query(
      `
      INSERT INTO activity_audit
        (
          user_id,
          email,
          action,
          entity_type,
          entity_id,
          store_id,
          metadata
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        actor_user_id,
        actor_email,
        action,
        entity_type,
        entity_id,
        store_id,
        metadata
      ]
    );
  } catch (e) {
    console.error("[audit] write failed:", e.message);
    // NEVER throw — audit must not break core flows
  }
}

module.exports = {
  writeAuditLog
};
