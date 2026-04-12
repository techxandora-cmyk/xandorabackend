// src/middleware/activityLogger.js
module.exports = function logActivity(action, entity_type) {
  return async (req, res, next) => {
    res.on("finish", async () => {
      if (!req.user || res.statusCode >= 400) return;

      const pool = req.app.locals.pool;

      await pool.query(
        `
        INSERT INTO activity_audit
          (user_id, email, action, entity_type, entity_id, metadata)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          req.user.user_id,
          req.user.email,
          action,
          entity_type,
          req.params.store_id || null,
          req.body || null
        ]
      );
    });
    next();
  };
};
