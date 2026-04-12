function normalizeScanTag(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeStoreScope(value) {
  const clean = String(value || "").trim();
  return clean || "_NO_STORE_";
}

function toTimestamp(value, fallback = new Date()) {
  const ts = value ? new Date(value) : new Date(fallback);
  if (Number.isNaN(ts.getTime())) return new Date(fallback);
  return ts;
}

function aggregateScanItems(items = []) {
  const byTag = new Map();
  const startedAt = new Date();
  let earliest = null;
  let latest = null;
  let receivedCount = 0;

  for (const item of items) {
    const payload =
      item && typeof item === "object" && !Array.isArray(item)
        ? item
        : { tag: item };
    const tag = normalizeScanTag(payload.tag || payload.epc || payload.code);
    if (!tag) continue;

    receivedCount += 1;
    const ts = toTimestamp(payload.ts || payload.seen_at || payload.last_seen || new Date());
    const rssiRaw = payload.rssi != null ? Number(payload.rssi) : null;
    const rssi = Number.isFinite(rssiRaw) ? rssiRaw : null;

    earliest = !earliest || ts < earliest ? ts : earliest;
    latest = !latest || ts > latest ? ts : latest;

    const existing = byTag.get(tag);
    if (!existing) {
      byTag.set(tag, {
        tag,
        observation_count: 1,
        first_seen_at: ts,
        last_seen_at: ts,
        strongest_rssi: rssi,
        average_rssi: rssi,
        raw_items: [payload],
        sample: payload,
      });
      continue;
    }

    existing.observation_count += 1;
    if (ts < existing.first_seen_at) existing.first_seen_at = ts;
    if (ts > existing.last_seen_at) {
      existing.last_seen_at = ts;
      existing.sample = payload;
    }
    if (rssi != null) {
      existing.strongest_rssi =
        existing.strongest_rssi == null
          ? rssi
          : Math.max(existing.strongest_rssi, rssi);
      const prevAvg = Number(existing.average_rssi || 0);
      const prevCount = Math.max(existing.observation_count - 1, 0);
      existing.average_rssi = Number(
        ((prevAvg * prevCount + rssi) / Math.max(existing.observation_count, 1)).toFixed(2)
      );
    }
    existing.raw_items.push(payload);
  }

  const finishedAt = latest || startedAt;
  const windowMs = Math.max(
    1,
    (latest || startedAt).getTime() - (earliest || startedAt).getTime() || 1
  );

  return {
    itemsByTag: byTag,
    received_count: receivedCount,
    unique_epc_count: byTag.size,
    started_at: earliest || startedAt,
    ended_at: finishedAt,
    duration_ms: windowMs,
  };
}

function decideScanDisposition(input = {}) {
  const previous = input.previous && typeof input.previous === "object" ? input.previous : {};
  const observation =
    input.observation && typeof input.observation === "object" ? input.observation : {};
  const now = toTimestamp(input.now || observation.last_seen_at || new Date());
  const stabilityThreshold = Math.max(Number(input.stabilityThreshold || 1), 1);
  const duplicateWindowMs = Math.max(Number(input.duplicateWindowMs || 2500), 0);
  const hasConfiguredMinRssi =
    input.minRssi !== null &&
    input.minRssi !== undefined &&
    String(input.minRssi).trim() !== "";
  const minRssi = hasConfiguredMinRssi && Number.isFinite(Number(input.minRssi))
    ? Number(input.minRssi)
    : null;

  const previousReads = Math.max(Number(previous.read_count || 0), 0);
  const incomingReads = Math.max(Number(observation.observation_count || 0), 0);
  const totalReads = previousReads + incomingReads;
  const strongestRssi = observation.strongest_rssi;
  const lastConfirmedAt = previous.last_confirmed_at
    ? toTimestamp(previous.last_confirmed_at, now)
    : null;

  const noisy =
    minRssi != null && Number.isFinite(strongestRssi) && strongestRssi < minRssi;
  const stable = totalReads >= stabilityThreshold;
  const duplicate =
    !!lastConfirmedAt &&
    duplicateWindowMs > 0 &&
    now.getTime() - lastConfirmedAt.getTime() < duplicateWindowMs;

  let status = "CONFIRMED";
  if (noisy) {
    status = "NOISY";
  } else if (!stable) {
    status = "PENDING";
  } else if (duplicate) {
    status = "DUPLICATE";
  }

  return {
    status,
    stable,
    duplicate,
    noisy,
    confirmed: status === "CONFIRMED",
    total_reads: totalReads,
    incoming_reads: incomingReads,
  };
}

function batchMetrics(input = {}) {
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  const totalReads = decisions.reduce(
    (sum, row) => sum + Number(row?.observation?.observation_count || 0),
    0
  );
  const confirmed = decisions.filter((row) => row?.decision?.status === "CONFIRMED").length;
  const duplicates = decisions.filter((row) => row?.decision?.status === "DUPLICATE").length;
  const noisy = decisions.filter((row) => row?.decision?.status === "NOISY").length;
  const pending = decisions.filter((row) => row?.decision?.status === "PENDING").length;
  const durationMs = Math.max(Number(input.duration_ms || 0), 1);
  const readRate = Number(((totalReads / durationMs) * 1000).toFixed(2));

  return {
    received_count: Number(input.received_count || totalReads || decisions.length),
    unique_epc_count: Number(input.unique_epc_count || decisions.length),
    confirmed_count: confirmed,
    duplicate_count: duplicates,
    noisy_count: noisy,
    pending_count: pending,
    total_reads: totalReads,
    duration_ms: durationMs,
    read_rate: readRate,
  };
}

module.exports = {
  aggregateScanItems,
  batchMetrics,
  decideScanDisposition,
  normalizeScanTag,
  normalizeStoreScope,
  toTimestamp,
};
