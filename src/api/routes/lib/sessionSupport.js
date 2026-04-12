function normalizeSessionStatus(status) {
  const raw = String(status || "").trim().toUpperCase();
  if (raw === "ENDED") return "COMPLETED";
  if (raw === "DONE") return "COMPLETED";
  return raw || "UNKNOWN";
}

function buildSessionId(prefix, row = {}) {
  const explicit = String(row.session_id || "").trim();
  if (explicit) return explicit;

  const cleanPrefix = String(prefix || "SESSION").trim().toUpperCase();
  const id = row.id != null ? String(row.id).trim() : "PENDING";
  return `${cleanPrefix}-${id}`;
}

function durationSeconds(startedAt, endedAt = null) {
  const startMs = new Date(startedAt || 0).getTime();
  if (!Number.isFinite(startMs) || startMs <= 0) return 0;

  const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(endMs) || endMs < startMs) return 0;

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function readRate(totalReads, seconds) {
  const reads = Number(totalReads || 0);
  const duration = Number(seconds || 0);
  if (!Number.isFinite(reads) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Number((reads / duration).toFixed(2));
}

function summarizeSession(prefix, row = {}, metrics = {}) {
  const startedAt = row.started_at || metrics.started_at || null;
  const endedAt = row.ended_at || metrics.ended_at || null;
  const totalReads = Number(
    metrics.total_reads != null
      ? metrics.total_reads
      : metrics.reads != null
      ? metrics.reads
      : 0
  );
  const seconds = Number(
    metrics.duration_seconds != null
      ? metrics.duration_seconds
      : durationSeconds(startedAt, endedAt)
  );

  return {
    ...row,
    session_id: buildSessionId(prefix, row),
    status: normalizeSessionStatus(row.status),
    duration_seconds: seconds,
    total_reads: totalReads,
    read_rate: readRate(totalReads, seconds),
    metrics_summary:
      metrics.metrics_summary && typeof metrics.metrics_summary === "object"
        ? metrics.metrics_summary
        : row.metrics_summary && typeof row.metrics_summary === "object"
        ? row.metrics_summary
        : {},
  };
}

module.exports = {
  buildSessionId,
  durationSeconds,
  normalizeSessionStatus,
  readRate,
  summarizeSession,
};
