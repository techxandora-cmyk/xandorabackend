class LaundryStore {
  constructor() {
    this.byEpc = new Map();
    this.recentEvents = [];
    this.maxRecentEvents = 300;
  }

  touch(item, meta = {}) {
    const now = Date.now();
    const epc = String(item.epc || "").trim().toUpperCase();
    const nextStatus = String(meta.status || item.laundryStatus || "Received").trim();
    const existing = this.byEpc.get(epc);

    const row = {
      epc,
      sku: item.sku,
      name: item.name,
      category: item.category,
      bin: item.bin || "",
      size: item.size || "",
      color: item.color || "",
      status: nextStatus,
      storeId: String(meta.store_id || meta.storeId || "STORE_DEMO"),
      deviceId: String(meta.device_id || meta.deviceId || "LAUNDRY_STATION"),
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      scans: Number(existing?.scans || 0) + 1,
      notes: item.notes || "",
    };

    this.byEpc.set(epc, row);
    this.recentEvents.unshift({
      at: now,
      epc,
      sku: row.sku,
      name: row.name,
      category: row.category,
      bin: row.bin,
      size: row.size,
      color: row.color,
      status: row.status,
      scans: row.scans,
      store_id: row.storeId,
      device_id: row.deviceId,
    });

    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.length = this.maxRecentEvents;
    }

    return { ...row };
  }

  summary() {
    const byStatus = {};
    for (const row of this.byEpc.values()) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    }

    return {
      uniqueEpcs: this.byEpc.size,
      totalScanEvents: [...this.byEpc.values()].reduce(
        (sum, row) => sum + Number(row.scans || 0),
        0
      ),
      byStatus,
    };
  }

  recent(limit = 80) {
    const n = Math.min(Math.max(Number(limit || 80), 1), this.maxRecentEvents);
    return this.recentEvents.slice(0, n).map((row) => ({
      ...row,
      at_iso: new Date(row.at).toISOString(),
    }));
  }

  list() {
    return [...this.byEpc.values()]
      .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
      .map((row) => ({
        ...row,
        first_seen_iso: new Date(row.firstSeenAt).toISOString(),
        last_seen_iso: new Date(row.lastSeenAt).toISOString(),
      }));
  }

  clear() {
    this.byEpc.clear();
    this.recentEvents = [];
    return this.summary();
  }
}

module.exports = {
  LaundryStore,
};
