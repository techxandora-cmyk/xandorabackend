// src/api/routes/metrics.js
const express = require('express');
const router = express.Router();
const db = require('../../services/db');
const logger = require('../../services/logger');

/**
 * GET /api/v1/metrics/summary
 * {
 *   total_sales_amount,
 *   total_pos_transactions,
 *   total_items_sold,
 *   items_scanned_today,
 *   items_scanned_24h,
 *   last_updated
 * }
 */
router.get('/summary', async (_req, res) => {
  try {
    // POS totals
    const [[posAgg]] = await db.query(`
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_sales_amount,
        COUNT(*) AS total_pos_transactions,
        COALESCE(SUM(JSON_LENGTH(items)), 0) AS total_items_sold
      FROM pos_transactions
      WHERE status = 'CONFIRMED'
    `);

    // SCAN counters (today / 24h) based on SCAN_BATCH events
    const [[scanToday]] = await db.query(`
      SELECT COALESCE(SUM(JSON_EXTRACT(data, '$.count')), 0) AS scanned
      FROM tag_events
      WHERE event_type='SCAN_BATCH'
        AND DATE(created_at) = CURDATE()
    `);

    const [[scan24h]] = await db.query(`
      SELECT COALESCE(SUM(JSON_EXTRACT(data, '$.count')), 0) AS scanned
      FROM tag_events
      WHERE event_type='SCAN_BATCH'
        AND created_at >= (NOW() - INTERVAL 24 HOUR)
    `);

    return res.json({
      total_sales_amount: Number(posAgg.total_sales_amount || 0),
      total_pos_transactions: Number(posAgg.total_pos_transactions || 0),
      total_items_sold: Number(posAgg.total_items_sold || 0),
      items_scanned_today: Number(scanToday.scanned || 0),
      items_scanned_24h: Number(scan24h.scanned || 0),
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'metrics/summary error');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
