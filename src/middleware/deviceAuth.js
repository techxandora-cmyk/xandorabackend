const db = require('../services/db');
const logger = require('../services/logger');

/**
 * Simple Bearer token device auth.
 * Expect Authorization: Bearer <device_token>
 * Devices table should store token_hash (in dev we match token directly; in prod store hashed).
 */
module.exports = async function deviceAuth(req, res, next) {
  try {
    const auth = (req.get('Authorization') || '').trim();
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing auth' });
    const token = auth.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'missing token' });

    // Lookup device by token (replace with hashed-compare in production)
    const [rows] = await db.query('SELECT id, name, store_id, active FROM devices WHERE token = ? LIMIT 1', [token]);
    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'invalid device token' });
    }
    const device = rows[0];
    if (!device.active) return res.status(403).json({ error: 'device disabled' });

    // Attach device info to request
    req.device = { id: device.id, name: device.name, store_id: device.store_id };
    // update last_seen async (do not block)
    db.query('UPDATE devices SET last_seen = NOW() WHERE id = ?', [device.id]).catch(err => {
      logger.warn({ err: err && err.message ? err.message : err }, 'failed update device last_seen');
    });

    next();
  } catch (err) {
    logger.error({ err: err && err.message ? err.message : err }, 'deviceAuth error');
    return res.status(500).json({ error: 'internal' });
  }
};
