const {
  aggregateScanItems,
  batchMetrics,
  decideScanDisposition,
  normalizeStoreScope,
} = require("../api/routes/lib/scanEngine");

describe("scanEngine", () => {
  it("aggregates repeated EPC reads into a single observation", () => {
    const batch = aggregateScanItems([
      { tag: "epc-001", ts: "2026-03-30T10:00:00.000Z", rssi: -58 },
      { tag: "EPC-001", ts: "2026-03-30T10:00:01.000Z", rssi: -52 },
      { tag: "epc-002", ts: "2026-03-30T10:00:02.000Z", rssi: -61 },
    ]);

    expect(batch.received_count).toBe(3);
    expect(batch.unique_epc_count).toBe(2);

    const epc001 = batch.itemsByTag.get("EPC-001");
    expect(epc001).toBeTruthy();
    expect(epc001.observation_count).toBe(2);
    expect(epc001.strongest_rssi).toBe(-52);
    expect(epc001.first_seen_at.toISOString()).toBe("2026-03-30T10:00:00.000Z");
    expect(epc001.last_seen_at.toISOString()).toBe("2026-03-30T10:00:01.000Z");
  });

  it("marks reads as pending, confirmed, or duplicate based on stability and time window", () => {
    const observation = {
      observation_count: 1,
      strongest_rssi: -45,
      last_seen_at: new Date("2026-03-30T10:05:00.000Z"),
    };

    const pending = decideScanDisposition({
      previous: { read_count: 0 },
      observation,
      now: observation.last_seen_at,
      stabilityThreshold: 2,
      duplicateWindowMs: 2500,
    });
    expect(pending.status).toBe("PENDING");

    const confirmed = decideScanDisposition({
      previous: { read_count: 1, last_confirmed_at: null },
      observation,
      now: observation.last_seen_at,
      stabilityThreshold: 2,
      duplicateWindowMs: 2500,
    });
    expect(confirmed.status).toBe("CONFIRMED");

    const duplicate = decideScanDisposition({
      previous: {
        read_count: 5,
        last_confirmed_at: "2026-03-30T10:04:58.500Z",
      },
      observation,
      now: observation.last_seen_at,
      stabilityThreshold: 2,
      duplicateWindowMs: 2500,
    });
    expect(duplicate.status).toBe("DUPLICATE");
  });

  it("counts noisy reads separately in batch metrics", () => {
    const decisions = [
      {
        observation: { observation_count: 2 },
        decision: { status: "CONFIRMED" },
      },
      {
        observation: { observation_count: 1 },
        decision: { status: "NOISY" },
      },
    ];

    const metrics = batchMetrics({
      decisions,
      received_count: 3,
      unique_epc_count: 2,
      duration_ms: 1000,
    });

    expect(metrics.confirmed_count).toBe(1);
    expect(metrics.noisy_count).toBe(1);
    expect(metrics.total_reads).toBe(3);
    expect(metrics.read_rate).toBe(3);
    expect(normalizeStoreScope("")).toBe("_NO_STORE_");
  });

  it("does not treat missing minRssi configuration as zero", () => {
    const decision = decideScanDisposition({
      previous: { read_count: 1, last_confirmed_at: null },
      observation: {
        observation_count: 1,
        strongest_rssi: -48,
        last_seen_at: new Date("2026-03-30T10:10:00.000Z"),
      },
      now: new Date("2026-03-30T10:10:00.000Z"),
      stabilityThreshold: 2,
      duplicateWindowMs: 2500,
      minRssi: null,
    });

    expect(decision.status).toBe("CONFIRMED");
    expect(decision.noisy).toBe(false);
  });
});
