require("dotenv").config();
const { Pool } = require("pg");
const rabbit = require("../src/services/rabbit");
const logger = require("../src/services/logger");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@127.0.0.1:5432/rfid",
});

function normalizeEpcs(job) {
  if (!job || typeof job !== "object") return [];

  const fromEpcs = Array.isArray(job.epcs) ? job.epcs : [];
  const fromItems = Array.isArray(job.items)
    ? job.items.map((item) => item?.epc || item?.tag)
    : [];
  const single = job.epc || job.tag ? [job.epc || job.tag] : [];

  return Array.from(
    new Set(
      [...fromEpcs, ...fromItems, ...single]
        .map((v) => String(v || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

async function processJob(job) {
  const epcs = normalizeEpcs(job);
  if (!epcs.length) {
    return { inserted: 0, reason: "no_epcs" };
  }

  const deviceId = String(job?.device_id || "scan_worker");
  const storeId = job?.store_id ? String(job.store_id) : null;
  const extBatchId = job?.ext_batch_id || job?.batch_id || null;
  const rawJson = JSON.stringify(job || {});

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchRes = await client.query(
      `
      INSERT INTO scan_batches (device_id, store_id, ext_id, metadata)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id
      `,
      [deviceId, storeId, extBatchId, rawJson]
    );
    const batchId = batchRes.rows[0].id;

    await client.query(
      `
      INSERT INTO devices (device_id, name, store_id, status, last_seen, metadata)
      VALUES ($1, $2, $3, 'online', NOW(), '{}'::jsonb)
      ON CONFLICT (device_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, devices.name),
        store_id = EXCLUDED.store_id,
        status = 'online',
        last_seen = NOW(),
        updated_at = NOW()
      `,
      [deviceId, deviceId, storeId]
    );

    for (const epc of epcs) {
      await client.query(
        `
        INSERT INTO scan_items (batch_id, device_id, tag, ts, store_id)
        VALUES ($1, $2, $3, NOW(), $4)
        `,
        [batchId, deviceId, epc, storeId]
      );
    }

    await client.query("COMMIT");
    return { inserted: epcs.length, batch_id: batchId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function start() {
  await rabbit.connect();
  logger.info({ queue: "scan_jobs" }, "Worker connected to RabbitMQ");

  await rabbit.consume("scan_jobs", async (job) => {
    const result = await processJob(job);
    if (result.inserted > 0) {
      logger.info(
        {
          inserted: result.inserted,
          batch_id: result.batch_id,
        },
        "Worker stored scan tags"
      );
    }
  });

  logger.info({ queue: "scan_jobs" }, "Worker listening for scan jobs");
}

if (require.main === module) {
  start().catch((err) => {
    logger.error(
      { err: err && err.message ? err.message : err },
      "Worker startup failed"
    );
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

module.exports = { start, processJob };
