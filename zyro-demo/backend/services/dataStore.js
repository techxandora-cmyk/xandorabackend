const fs = require("fs");
const path = require("path");

function getDataPath(fileName) {
  return path.join(__dirname, "..", "data", fileName);
}

function loadJson(fileName) {
  const filePath = getDataPath(fileName);
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function writeJson(fileName, payload) {
  const filePath = getDataPath(fileName);
  const next = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(filePath, next, "utf8");
}

function randomPick(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function createDemoDataStore() {
  const products = loadJson("products.json");
  const epcMapRows = loadJson("epc_map.json");
  const settings = loadJson("demo_settings.json");

  const productsBySku = new Map(products.map((p) => [String(p.sku), p]));
  const epcToSku = new Map();

  for (const row of epcMapRows) {
    if (!row || !row.epc || !row.sku) continue;
    epcToSku.set(String(row.epc), String(row.sku));
  }

  function resolveByEpc(epc) {
    const sku = epcToSku.get(String(epc));
    if (!sku) return null;

    const product = productsBySku.get(sku);
    if (!product) return null;

    return {
      epc: String(epc),
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: Number(product.price || 0),
      currency: product.currency || "LKR",
    };
  }

  function resolveOrAssignByEpc(epc, options = {}) {
    const key = String(epc).trim();
    if (!key) return null;

    const existing = resolveByEpc(key);
    if (existing) {
      return { item: existing, autoAssigned: false };
    }

    const pickedProduct = randomPick(products);
    if (!pickedProduct) {
      return null;
    }

    const sku = String(pickedProduct.sku);
    epcToSku.set(key, sku);
    epcMapRows.push({
      epc: key,
      sku,
    });

    if (options.persist !== false) {
      writeJson("epc_map.json", epcMapRows);
    }

    const assigned = resolveByEpc(key);
    return {
      item: assigned,
      autoAssigned: true,
    };
  }

  return {
    settings,
    products,
    epcMapRows,
    productsBySku,
    epcToSku,
    resolveByEpc,
    resolveOrAssignByEpc,
  };
}

module.exports = {
  createDemoDataStore,
};
