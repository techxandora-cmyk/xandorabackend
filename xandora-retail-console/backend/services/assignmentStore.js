const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "retail_assignments.json");

function normalizeEpc(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreId(value) {
  return String(value || "").trim().toUpperCase();
}

class AssignmentStore {
  constructor(filePath = STORE_PATH) {
    this.filePath = filePath;
    this.itemsByStore = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw);
      const stores = parsed && typeof parsed === "object" ? parsed.stores || {} : {};
      for (const [storeId, rows] of Object.entries(stores)) {
        const map = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
          const epc = normalizeEpc(row?.epc);
          if (epc) map.set(epc, { ...row, epc });
        }
        this.itemsByStore.set(normalizeStoreId(storeId), map);
      }
    } catch (_err) {
      this.itemsByStore = new Map();
    }
  }

  save() {
    const stores = {};
    for (const [storeId, rows] of this.itemsByStore.entries()) {
      stores[storeId] = [...rows.values()].sort((a, b) => String(b.epc).localeCompare(String(a.epc)));
    }
    fs.writeFileSync(this.filePath, `${JSON.stringify({ stores }, null, 2)}\n`, "utf8");
  }

  list(storeId) {
    const rows = this.itemsByStore.get(normalizeStoreId(storeId));
    return rows ? [...rows.values()] : [];
  }

  get(storeId, epc) {
    return this.itemsByStore.get(normalizeStoreId(storeId))?.get(normalizeEpc(epc)) || null;
  }

  upsert(storeId, item) {
    const normalizedStoreId = normalizeStoreId(storeId);
    const epc = normalizeEpc(item?.epc);
    if (!normalizedStoreId || !epc) return null;

    if (!this.itemsByStore.has(normalizedStoreId)) {
      this.itemsByStore.set(normalizedStoreId, new Map());
    }

    const next = {
      ...item,
      epc,
      updatedAt: new Date().toISOString(),
    };
    this.itemsByStore.get(normalizedStoreId).set(epc, next);
    this.save();
    return next;
  }

  delete(storeId, epc) {
    const normalizedStoreId = normalizeStoreId(storeId);
    const normalizedEpc = normalizeEpc(epc);
    const storeRows = this.itemsByStore.get(normalizedStoreId);
    if (!storeRows || !normalizedEpc) return false;
    const removed = storeRows.delete(normalizedEpc);
    if (removed) {
      this.save();
    }
    return removed;
  }
}

module.exports = {
  AssignmentStore,
};
