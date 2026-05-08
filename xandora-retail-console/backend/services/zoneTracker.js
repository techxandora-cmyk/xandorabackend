class ZoneTracker {
  constructor({ inZoneTimeoutMs }) {
    this.inZoneTimeoutMs = Math.max(Number(inZoneTimeoutMs || 4000), 1000);
    this.itemsByEpc = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (_err) {
        // Ignore listener errors so one bad listener won't break tracking.
      }
    }
  }

  touch(item, seenAt = Date.now()) {
    const epc = String(item.epc);
    const existing = this.itemsByEpc.get(epc);
    const next = {
      epc,
      sku: item.sku,
      name: item.name,
      category: item.category,
      bin: item.bin || "",
      size: item.size || "",
      color: item.color || "",
      price: Number(item.price || 0),
      currency: item.currency || "LKR",
      firstSeenAt: existing?.firstSeenAt || seenAt,
      lastSeenAt: seenAt,
    };

    this.itemsByEpc.set(epc, next);
    this.emit({
      type: existing ? "live.touch" : "live.enter",
      item: this.enrich(next),
      at: seenAt,
    });
    return this.enrich(next);
  }

  remove(epc, reason = "manual", at = Date.now()) {
    const key = String(epc);
    const existing = this.itemsByEpc.get(key);
    if (!existing) return null;

    this.itemsByEpc.delete(key);
    this.emit({
      type: "live.exit",
      reason,
      item: this.enrich(existing, at),
      at,
    });
    return this.enrich(existing, at);
  }

  cleanup(now = Date.now()) {
    for (const [epc, item] of this.itemsByEpc.entries()) {
      const ageMs = now - item.lastSeenAt;
      if (ageMs > this.inZoneTimeoutMs) {
        this.remove(epc, "timeout", now);
      }
    }
  }

  enrich(item, now = Date.now()) {
    const ageMs = Math.max(now - item.lastSeenAt, 0);
    return {
      ...item,
      ageMs,
      ageSec: Number((ageMs / 1000).toFixed(1)),
    };
  }

  list(now = Date.now()) {
    return [...this.itemsByEpc.values()]
      .map((item) => this.enrich(item, now))
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  }

  countBySku() {
    const counts = {};
    for (const item of this.itemsByEpc.values()) {
      counts[item.sku] = (counts[item.sku] || 0) + 1;
    }
    return counts;
  }
}

module.exports = {
  ZoneTracker,
};
