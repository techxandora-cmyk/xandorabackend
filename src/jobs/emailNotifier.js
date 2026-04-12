const nodemailer = require("nodemailer");

module.exports = function emailNotifier(pool) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  async function send(subject, body) {
    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO,
      subject,
      text: body,
    });
  }

  async function sendDailyDigest() {
    const r = await pool.query(
      `
      SELECT type, store_id, severity
      FROM alerts
      WHERE status='OPEN'
      ORDER BY severity DESC
      `
    );

    if (!r.rowCount) return;

    const lines = r.rows.map(
      a => `• ${a.type} | Store: ${a.store_id} | Severity: ${a.severity}`
    );

    await send(
      "Xandora Daily Alert Digest",
      lines.join("\n")
    );
  }

  async function sendWeeklyDigest() {
    const r = await pool.query(
      `
      SELECT
        store_id,
        COUNT(*) AS alerts,
        AVG(severity)::int AS avg_severity
      FROM alerts
      WHERE first_detected_at >= NOW() - INTERVAL '7 days'
      GROUP BY store_id
      `
    );

    if (!r.rowCount) return;

    const lines = r.rows.map(
      s =>
        `Store ${s.store_id}: ${s.alerts} alerts (avg severity ${s.avg_severity})`
    );

    await send(
      "Xandora Weekly Risk Summary",
      lines.join("\n")
    );
  }

  return { sendDailyDigest, sendWeeklyDigest };
};
