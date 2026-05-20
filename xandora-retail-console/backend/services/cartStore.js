class CartStore {
  constructor() {
    this.itemsByEpc = new Map();
    this.discount = { type: "amount", value: 0 };
  }

  add(item) {
    const epc = String(item.epc);
    if (!this.itemsByEpc.has(epc)) {
      this.itemsByEpc.set(epc, {
        epc,
        sku: item.sku,
        name: item.name,
        brand: item.brand || "",
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

  get(epc) {
    return this.itemsByEpc.get(String(epc)) || null;
  }

  remove(epc) {
    this.itemsByEpc.delete(String(epc));
    return this.snapshot();
  }

  clear() {
    this.itemsByEpc.clear();
    this.discount = { type: "amount", value: 0 };
    return this.snapshot();
  }

  setDiscount(input = {}) {
    const type = String(input.type || "").toLowerCase() === "percent" ? "percent" : "amount";
    const rawValue = Number(input.value || 0);
    this.discount = {
      type,
      value: Number.isFinite(rawValue) ? Math.max(rawValue, 0) : 0,
    };
    return this.snapshot();
  }

  snapshot() {
    const items = [...this.itemsByEpc.values()].sort((a, b) => b.addedAt - a.addedAt);
    const count = items.length;
    const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const discountAmount =
      this.discount.type === "percent"
        ? Math.min(subtotal, subtotal * Math.min(this.discount.value, 100) / 100)
        : Math.min(subtotal, this.discount.value);
    const total = Math.max(subtotal - discountAmount, 0);
    const currency = items[0]?.currency || "LKR";

    return {
      items,
      count,
      subtotal,
      discount: {
        ...this.discount,
        amount: discountAmount,
      },
      total,
      currency,
    };
  }
}

module.exports = {
  CartStore,
};
