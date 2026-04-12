const cron = require("node-cron");
const logger = require("../services/logger");

function clampDays(value, fallback, min = 1, max = 3650) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

async function tableExists(pool, tableName) {
  const result = await pool.query(`SELECT to_regclass($1) AS regclass_name`, [
    `public.${tableName}`,
  ]);
  return Boolean(result.rows[0]?.regclass_name);
}

function buildStatements(days) {
  return [
    {
      name: "billing_session_scans",
      table: "billing_session_scans",
      sql: `
        DELETE FROM billing_session_scans bss
        USING billing_sessions bs
        WHERE bss.session_id = bs.id
          AND bs.ended_at IS NOT NULL
          AND bs.ended_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.completedSessions],
    },
    {
      name: "billing_sessions",
      table: "billing_sessions",
      sql: `
        DELETE FROM billing_sessions
        WHERE ended_at IS NOT NULL
          AND ended_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.completedSessions],
    },
    {
      name: "inventory_scans",
      table: "inventory_scans",
      sql: `
        DELETE FROM inventory_scans scans
        USING inventory_sessions sessions
        WHERE scans.session_id = sessions.id
          AND sessions.ended_at IS NOT NULL
          AND sessions.ended_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.completedSessions],
    },
    {
      name: "inventory_sessions",
      table: "inventory_sessions",
      sql: `
        DELETE FROM inventory_sessions
        WHERE ended_at IS NOT NULL
          AND ended_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.completedSessions],
    },
    {
      name: "pos_transaction_items",
      table: "pos_transaction_items",
      sql: `
        DELETE FROM pos_transaction_items items
        USING pos_transactions tx
        WHERE items.pos_txn_id = tx.id
          AND tx.created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.posTransactions],
    },
    {
      name: "pos_transactions",
      table: "pos_transactions",
      sql: `
        DELETE FROM pos_transactions
        WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.posTransactions],
    },
    {
      name: "scan_items",
      table: "scan_items",
      sql: `
        DELETE FROM scan_items
        WHERE COALESCE(last_seen, ts, created_at) < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.scanItems],
    },
    {
      name: "scan_batches",
      table: "scan_batches",
      sql: `
        DELETE FROM scan_batches
        WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.scanBatches],
    },
    {
      name: "alerts",
      table: "alerts",
      sql: `
        DELETE FROM alerts
        WHERE status = 'RESOLVED'
          AND COALESCE(resolved_at, updated_at, last_detected_at) < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.resolvedAlerts],
    },
    {
      name: "activity_audit",
      table: "activity_audit",
      sql: `
        DELETE FROM activity_audit
        WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.activityAudit],
    },
    {
      name: "recent_events",
      table: "recent_events",
      sql: `
        DELETE FROM recent_events
        WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      params: [days.recentEvents],
    },
  ];
}

async function runRetentionSweep(pool, options = {}) {
  const days = {
    scanItems: clampDays(
      options.scanItems ?? process.env.SCAN_ITEM_RETENTION_DAYS,
      30
    ),
    scanBatches: clampDays(
      options.scanBatches ?? process.env.SCAN_BATCH_RETENTION_DAYS,
      30
    ),
    completedSessions: clampDays(
      options.completedSessions ?? process.env.COMPLETED_SESSION_RETENTION_DAYS,
      180
    ),
    posTransactions: clampDays(
      options.posTransactions ?? process.env.POS_TRANSACTION_RETENTION_DAYS,
      365
    ),
    resolvedAlerts: clampDays(
      options.resolvedAlerts ?? process.env.RESOLVED_ALERT_RETENTION_DAYS,
      90
    ),
    activityAudit: clampDays(
      options.activityAudit ?? process.env.ACTIVITY_AUDIT_RETENTION_DAYS,
      180
    ),
    recentEvents: clampDays(
      options.recentEvents ?? process.env.RECENT_EVENTS_RETENTION_DAYS,
      7
    ),
  };
  const dryRun =
    options.dryRun != null
      ? Boolean(options.dryRun)
      : String(process.env.DATA_RETENTION_DRY_RUN || "0") === "1";

  const client = await pool.connect();
  const summary = {
    dry_run: dryRun,
    rules: days,
    deleted: [],
  };

  try {
    if (!dryRun) {
      await client.query("BEGIN");
    }

    for (const statement of buildStatements(days)) {
      const exists = await tableExists(client, statement.table);
      if (!exists) {
        summary.deleted.push({
          table: statement.name,
          deleted: 0,
          skipped: true,
          reason: "missing_table",
        });
        continue;
      }

      if (dryRun) {
        summary.deleted.push({
          table: statement.name,
          deleted: 0,
          skipped: true,
          reason: "dry_run",
        });
        continue;
      }

      const result = await client.query(statement.sql, statement.params);
      summary.deleted.push({
        table: statement.name,
        deleted: result.rowCount,
      });
    }

    if (!dryRun) {
      await client.query("COMMIT");
    }

    logger.info({ retention: summary }, "Data retention sweep completed");
    return summary;
  } catch (err) {
    if (!dryRun) {
      await client.query("ROLLBACK");
    }
    logger.error(
      { err: err && err.message ? err.message : err },
      "Data retention sweep failed"
    );
    throw err;
  } finally {
    client.release();
  }
}

module.exports = function startDataRetentionJob(pool) {
  const enabled = String(process.env.DATA_RETENTION_ENABLED || "0") === "1";
  if (!enabled) {
    logger.info("Data retention job disabled");
    return {
      enabled: false,
      runNow: () => runRetentionSweep(pool, { dryRun: true }),
    };
  }

  const cronExpr = String(process.env.DATA_RETENTION_CRON || "35 2 * * *").trim();
  logger.info({ cron: cronExpr }, "Data retention job initialized");

  cron.schedule(cronExpr, async () => {
    try {
      await runRetentionSweep(pool);
    } catch (err) {
      logger.error(
        { err: err && err.message ? err.message : err },
        "Scheduled retention sweep failed"
      );
    }
  });

  return {
    enabled: true,
    runNow: (options) => runRetentionSweep(pool, options),
  };
};

module.exports.runRetentionSweep = runRetentionSweep;
