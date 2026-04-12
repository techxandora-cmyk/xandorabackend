// src/workers/scan_worker.js
require("dotenv").config();
const rabbit = require("../services/rabbit");
const db = require("../db");
const logger = require("../services/logger");

// use global fetch (Node 18+ / you have v22)
const INTERNAL_BASE = process.env.INTERNAL_BASE || "http://localhost:3000";

/**
 * Insert scan batch + items
 */
async function insertBatchAndItems(job) {
  const epcs = Array.isArray(job.epcs) ? job.epcs : [];
  if (!epcs.length) return { inserted: 0, batch_id: null };

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const conn = db.getConnection ? await db.getConnection() : null;

  try {
    if (conn) await conn.beginTransaction();

    // Insert batch row
    const [batchRes] = conn
      ? await conn.query(
          `INSERT INTO scan_batches (device_id, store_id, ext_id, metadata, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [job.device_id || null, job.store_id || null, job.ext_batch_id || null, job.raw ? JSON.stringify(job.raw) : null, now]
        )
      : await db.query(
          `INSERT INTO scan_batches (device_id, store_id, ext_id, metadata, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [job.device_id || null, job.store_id || null, job.ext_batch_id || null, job.raw ? JSON.stringify(job.raw) : null, now]
        );

    const batch_id = batchRes.insertId;

    // Insert scan_items
    const placeholders = [];
    const vals = [];
    for (const epc of epcs) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
      vals.push(
        batch_id,
        job.device_id || null,
        epc,
        now,
        job.store_id || null,
        job.raw ? JSON.stringify(job.raw) : null,
        job.rssi || null
      );
    }

    if (placeholders.length) {
      const sql = `
        INSERT IGNORE INTO scan_items
        (batch_id, device_id, tag, ts, store_id, raw, rssi)
        VALUES ${placeholders.join(",")}
      `;
      conn ? await conn.query(sql, vals) : await db.query(sql, vals);
    }

    // Device heartbeat
    await (conn
      ? conn.query(
          `INSERT INTO devices (device_id, name, store_id, status, last_seen, created_at, updated_at)
           VALUES (?, NULL, ?, 'online', ?, ?, ?)
           ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen), status='online', updated_at=VALUES(updated_at)`,
          [job.device_id, job.store_id || null, now, now, now]
        )
      : db.query(
          `INSERT INTO devices (device_id, name, store_id, status, last_seen, created_at, updated_at)
           VALUES (?, NULL, ?, 'online', ?, ?, ?)
           ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen), status='online', updated_at=VALUES(updated_at)`,
          [job.device_id, job.store_id || null, now, now, now]
        ));

    if (conn) await conn.commit();
    return { inserted: epcs.length, batch_id };
  } catch (e) {
    if (conn) try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    if (conn) try { conn.release(); } catch {}
  }
}

/**
 * Send live scan notification to SSE server (using fetch)
 */
async function notifyServerScan(batch_id, tag, device_id, ts) {
  try {
    const url = `${INTERNAL_BASE}/internal/emit/scan`;
    const body = { batch_id, tag, device_id, ts };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // timeout not directly supported by fetch; rely on default
    });
  } catch (e) {
    logger && logger.warn
      ? logger.warn({ err: e.message }, "notifyServerScan failed")
      : console.warn("notifyServerScan failed", e && e.message ? e.message : e);
  }
}

/**
 * Worker startup
 */
(async () => {
  try {
    await rabbit.connect();
    logger && logger.info ? logger.info("Worker connected to RabbitMQ (queue: scan_jobs)") : console.log("Worker connected");

    // rabbit.consume(queue, handler)
    await rabbit.consume("scan_jobs", async (job) => {
      try {
        logger && logger.info ? logger.info({ job }, "Processing scan job") : console.log("processing job", job);

        const epcs = Array.isArray(job.epcs) ? job.epcs : [];
        if (!epcs.length) {
          logger && logger.warn ? logger.warn("Job has no epcs") : console.warn("Job has no epcs");
          return;
        }

        const result = await insertBatchAndItems(job);
        logger && logger.info ? logger.info(result, "Inserted scan batch") : console.log("inserted", result);

        const ts = new Date().toISOString();
        for (const epc of epcs) {
          notifyServerScan(result.batch_id, epc, job.device_id || "unknown", ts);
        }
      } catch (err) {
        logger && logger.error ? logger.error({ err: err.message }, "Failed to process job") : console.error("job error", err);
      }
    });

    logger && logger.info ? logger.info("scan_worker now listening for scan_jobs...") : console.log("listening");
  } catch (e) {
    logger && logger.error ? logger.error({ err: e.message }, "Worker startup failed") : console.error("startup failed", e);
    process.exit(1);
  }
})();
