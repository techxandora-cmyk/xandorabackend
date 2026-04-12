module.exports = async function escalateAlerts(pool) {
  await pool.query(
    `
    UPDATE alerts
    SET severity = severity + 10
    WHERE status='OPEN'
    AND first_detected_at < NOW() - INTERVAL '3 days'
    `
  );

  await pool.query(
    `
    UPDATE alerts
    SET severity = severity + 20
    WHERE status='OPEN'
    AND first_detected_at < NOW() - INTERVAL '6 days'
    `
  );
};
