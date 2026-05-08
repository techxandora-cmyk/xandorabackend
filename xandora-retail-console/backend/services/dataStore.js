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

  function getEpcRow(epc) {
    const key = String(epc || "").trim().toUpperCase();
    return epcMapRows.find((row) => String(row?.epc || "").toUpperCase() === key) || null;
  }

  function resolveByEpc(epc) {
    const key = String(epc || "").trim().toUpperCase();
    const sku = epcToSku.get(key);
    if (!sku) return null;

    const product = productsBySku.get(sku);
    if (!product) return null;
    const epcRow = getEpcRow(key);

    return {
      epc: key,
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: Number(product.price || 0),
      currency: product.currency || "LKR",
      stock: Number(product.stock || 0),
      bin: epcRow?.bin || "",
      color: epcRow?.color || product.color || "",
      size: epcRow?.size || product.size || "",
      laundryStatus: epcRow?.laundryStatus || "Ready",
      notes: epcRow?.notes || "",
    };
  }

  function resolveOrAssignByEpc(epc, options = {}) {
    const key = String(epc).trim().toUpperCase();
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
      bin: "Demo Bin",
      laundryStatus: "Ready",
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

  function upsertProduct(input = {}) {
    const sku = String(input.sku || "").trim().toUpperCase();
    if (!sku) return null;

    const existing = productsBySku.get(sku);
    const next = {
      sku,
      name: String(input.name || existing?.name || sku).trim(),
      category: String(input.category || existing?.category || "Demo Items").trim(),
      price: Number(input.price || existing?.price || 0),
      currency: String(input.currency || existing?.currency || "LKR").trim() || "LKR",
      stock: Math.max(Number(input.stock || existing?.stock || 1), 0),
      color: String(input.color || existing?.color || "").trim(),
      size: String(input.size || existing?.size || "").trim(),
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      products.push(next);
      productsBySku.set(sku, next);
    }

    writeJson("products.json", products);
    return productsBySku.get(sku);
  }

  function assignEpc(input = {}) {
    const epc = String(input.epc || "").trim().toUpperCase();
    if (!epc) return null;

    const product = upsertProduct(input);
    if (!product) return null;

    const existing = getEpcRow(epc);
    const row = {
      epc,
      sku: product.sku,
      bin: String(input.bin || existing?.bin || "").trim(),
      color: String(input.color || existing?.color || product.color || "").trim(),
      size: String(input.size || existing?.size || product.size || "").trim(),
      laundryStatus: String(input.laundryStatus || existing?.laundryStatus || "Ready").trim(),
      notes: String(input.notes || existing?.notes || "").trim(),
      assignedAt: new Date().toISOString(),
    };

    if (existing) {
      Object.assign(existing, row);
    } else {
      epcMapRows.push(row);
    }

    epcToSku.set(epc, product.sku);
    writeJson("epc_map.json", epcMapRows);

    return resolveByEpc(epc);
  }

  function listAssignments(options = {}) {
    const includeSeed = options.includeSeed !== false;
    return epcMapRows
      .filter((row) => includeSeed || row.assignedAt)
      .map((row) => resolveByEpc(row.epc))
      .filter(Boolean)
      .sort((a, b) => String(b.epc).localeCompare(String(a.epc)));
  }

  function listProducts(options = {}) {
    const includeSeed = options.includeSeed !== false;
    if (includeSeed) return [...products];

    const assignedSkus = new Set(
      epcMapRows
        .filter((row) => row.assignedAt)
        .map((row) => String(row.sku || ""))
        .filter(Boolean)
    );

    return products.filter((product) => assignedSkus.has(String(product.sku)));
  }

  function isAssigned(epc) {
    return Boolean(getEpcRow(epc));
  }

  return {
    settings,
    products,
    epcMapRows,
    productsBySku,
    epcToSku,
    listProducts,
    listAssignments,
    isAssigned,
    assignEpc,
    resolveByEpc,
    resolveOrAssignByEpc,
  };
}

module.exports = {
  createDemoDataStore,
};
