class CartStore {
  constructor() {
    this.itemsByEpc = new Map();
  }

  add(item) {
    const epc = String(item.epc);
    if (!this.itemsByEpc.has(epc)) {
      this.itemsByEpc.set(epc, {
        epc,
        sku: item.sku,
        name: item.name,
        category: item.category,
        bin: item.bin || "",
        size: item.size || "",
        color: item.color || "",
        price: Number(item.price || 0),
        currency: item.currency || "LKR",
        addedAt: Date.now(),
      });
    }
    return this.snapshot();
  }

  remove(epc) {
    this.itemsByEpc.delete(String(epc));
    return this.snapshot();
  }

  clear() {
    this.itemsByEpc.clear();
    return this.snapshot();
  }

  snapshot() {
    const items = [...this.itemsByEpc.values()].sort((a, b) => b.addedAt - a.addedAt);
    const count = items.length;
    const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const currency = items[0]?.currency || "LKR";

    return {
      items,
      count,
      total,
      currency,
    };
  }
}

module.exports = {
  CartStore,
};
