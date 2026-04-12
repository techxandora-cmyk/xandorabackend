const cron = require("node-cron");
const nodemailer = require("nodemailer");
const logger = require("../services/logger");
const {
  resolveOperationalAlert,
  upsertOperationalAlert,
} = require("../api/routes/lib/operationalAlerts");

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value || 0), min), max);
}

function buildTransporter() {
  if (!process.env.SMTP_HOST || !process.env.ALERT_EMAIL_TO || !process.env.ALERT_EMAIL_FROM) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });
}

module.exports = function startAlertScheduler(pool) {
  logger.info("Alert scheduler initialized");

  const transporter = buildTransporter();
  const offlineThresholdMinutes = clamp(
    process.env.DEVICE_OFFLINE_THRESHOLD_MINUTES || 3,
    1,
    120
  );
  const offlineThresholdMs = offlineThresholdMinutes * 60 * 1000;

  async function sendEmail(subject, body) {
    if (!transporter) {
      logger.warn("SMTP not configured, skipping alert digest email");
      return false;
    }

    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO,
      subject,
      text: body,
    });

    return true;
  }

  async function sweepReaderConnectivity() {
    const client = await pool.connect();

    try {
      const devices = await client.query(
        `
        SELECT
          device_id,
          store_id,
          name,
          device_type,
          location_label,
          zone_label,
          status,
          last_seen,
          last_heartbeat
        FROM devices
        ORDER BY updated_at DESC, device_id ASC
        `
      );

      const nowMs = Date.now();

      for (const row of devices.rows) {
        const deviceId = String(row.device_id || "").trim();
        if (!deviceId) continue;

        const referenceTs = row.last_heartbeat || row.last_seen || null;
        const lastSignalMs = referenceTs ? new Date(referenceTs).getTime() : NaN;
        const isOffline =
          !Number.isFinite(lastSignalMs) || nowMs - lastSignalMs > offlineThresholdMs;

        await client.query(
          `
          UPDATE devices
          SET
            status = $2,
            heartbeat_error = CASE WHEN $2 = 'offline' THEN $3 ELSE NULL END,
            updated_at = NOW()
          WHERE device_id = $1
          `,
          [
            deviceId,
            isOffline ? "offline" : "online",
            isOffline
              ? `No heartbeat within ${offlineThresholdMinutes} minute(s)`
              : null,
          ]
        );

        if (isOffline) {
          await upsertOperationalAlert(client, {
            type: "READER_OFFLINE",
            entity_type: "DEVICE",
            entity_id: deviceId,
            store_id: row.store_id || null,
            severity: 72,
            metadata: {
              device_id: deviceId,
              device_name: row.name || deviceId,
              device_type: row.device_type || null,
              location_label: row.location_label || null,
              zone_label: row.zone_label || null,
              last_seen: row.last_seen || null,
              last_heartbeat: row.last_heartbeat || null,
              offline_threshold_minutes: offlineThresholdMinutes,
            },
          });
          continue;
        }

        await resolveOperationalAlert(client, {
          type: "READER_OFFLINE",
          entity_type: "DEVICE",
          entity_id: deviceId,
          store_id: row.store_id || null,
          metadata: {
            device_id: deviceId,
            recovered_at: new Date().toISOString(),
            last_heartbeat: row.last_heartbeat || row.last_seen || null,
          },
        });
      }
    } finally {
      client.release();
    }
  }

  /* ======================================================
     1. READER CONNECTIVITY SWEEP (every 5 minutes)
     ====================================================== */
  cron.schedule("*/5 * * * *", async () => {
    try {
      await sweepReaderConnectivity();
    } catch (err) {
      logger.error(
        { err: err && err.message ? err.message : err },
        "Reader connectivity sweep error"
      );
    }
  });

  /* ======================================================
     2. ADMIN-ACTION SEVERITY TUNING (01:50)
     ====================================================== */
  cron.schedule("50 1 * * *", async () => {
    logger.info("Running admin-action severity tuning");

    try {
      await pool.query(
        `
        UPDATE alerts
        SET severity = LEAST(severity + 10, 100)
        WHERE type = 'ADMIN_ACTION'
          AND status = 'OPEN'
          AND first_detected_at < NOW() - INTERVAL '24 hours'
        `
      );

      await pool.query(
        `
        UPDATE alerts
        SET severity = LEAST(severity + 20, 100)
        WHERE type = 'ADMIN_ACTION'
          AND status = 'OPEN'
          AND first_detected_at < NOW() - INTERVAL '72 hours'
        `
      );
    } catch (err) {
      logger.error(
        { err: err && err.message ? err.message : err },
        "Admin-action escalation error"
      );
    }
  });

  /* ======================================================
     3. DAILY EMAIL DIGEST (02:20)
     ====================================================== */
  cron.schedule("20 2 * * *", async () => {
    logger.info("Running daily alert digest");

    try {
      const alerts = await pool.query(
        `
        SELECT
          type,
          store_id,
          severity,
          metadata,
          first_detected_at
        FROM alerts
        WHERE status = 'OPEN'
        ORDER BY severity DESC
        `
      );

      if (!alerts.rowCount) return;

      const adminActions = alerts.rows.filter((alert) => alert.type === "ADMIN_ACTION");
      const otherAlerts = alerts.rows.filter((alert) => alert.type !== "ADMIN_ACTION");

      let body = "";

      if (adminActions.length) {
        body += "=== ADMIN ACTION ALERTS ===\n";
        for (const alert of adminActions) {
          body += `* ${alert.metadata?.action || "ACTION"} | `;
          body += `Store: ${alert.store_id || "GLOBAL"} | `;
          body += `Severity: ${alert.severity} | `;
          body += `By: ${alert.metadata?.actor || "unknown"}\n`;
        }
        body += "\n";
      }

      if (otherAlerts.length) {
        body += "=== OPERATIONAL ALERTS ===\n";
        for (const alert of otherAlerts) {
          body += `* ${alert.type} | `;
          body += `Store: ${alert.store_id || "N/A"} | `;
          body += `Severity: ${alert.severity}\n`;
        }
      }

      await sendEmail("Xandora Daily Alert Digest", body);
    } catch (err) {
      logger.error(
        { err: err && err.message ? err.message : err },
        "Daily digest error"
      );
    }
  });
};
