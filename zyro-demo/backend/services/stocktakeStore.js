class StocktakeStore {
  constructor() {
    this.byEpc = new Map();
    this.recentEvents = [];
    this.maxRecentEvents = 300;
  }

  touch(item, meta = {}) {
    const now = Date.now();
    const epc = String(item.epc);
    const existing = this.byEpc.get(epc);

    const deviceId = String(meta.device_id || meta.deviceId || "HANDHELD");
    const storeId = String(meta.store_id || meta.storeId || "STORE_DEMO");

    if (!existing) {
      this.byEpc.set(epc, {
        epc,
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: Number(item.price || 0),
        currency: item.currency || "LKR",
        firstSeenAt: now,
        lastSeenAt: now,
        scans: 1,
        storeId,
        deviceId,
      });
    } else {
      existing.lastSeenAt = now;
      existing.scans += 1;
      existing.deviceId = deviceId;
      existing.storeId = storeId;
    }

    const row = this.byEpc.get(epc);
    this.recentEvents.unshift({
      at: now,
      epc,
      sku: row.sku,
      name: row.name,
      category: row.category,
      scans: row.scans,
      store_id: row.storeId,
      device_id: row.deviceId,
    });
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.length = this.maxRecentEvents;
    }

    return { ...row };
  }

  countBySku() {
    const out = {};
    for (const row of this.byEpc.values()) {
      out[row.sku] = (out[row.sku] || 0) + 1;
    }
    return out;
  }

  summary() {
    let totalScanEvents = 0;
    for (const row of this.byEpc.values()) {
      totalScanEvents += Number(row.scans || 0);
    }
    return {
      uniqueEpcs: this.byEpc.size,
      totalScanEvents,
      recentEvents: this.recentEvents.length,
    };
  }

  recent(limit = 80) {
    const n = Math.min(Math.max(Number(limit || 80), 1), 300);
    return this.recentEvents.slice(0, n).map((row) => ({
      ...row,
      at_iso: new Date(row.at).toISOString(),
    }));
  }

  clear() {
    this.byEpc.clear();
    this.recentEvents = [];
    return this.summary();
  }
}

module.exports = {
  StocktakeStore,
};
