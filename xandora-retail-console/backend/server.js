const path = require("path");
const express = require("express");
const cors = require("cors");
const { createDemoDataStore } = require("./services/dataStore");
const { ZoneTracker } = require("./services/zoneTracker");
const { CartStore } = require("./services/cartStore");
const { StocktakeStore } = require("./services/stocktakeStore");
const { LaundryStore } = require("./services/laundryStore");

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || "0.0.0.0";
const IN_ZONE_TIMEOUT_MS = Number(process.env.DEMO_IN_ZONE_TIMEOUT_MS || 4000);
const CLEANUP_INTERVAL_MS = Number(process.env.DEMO_CLEANUP_INTERVAL_MS || 1000);
const SIM_INTERVAL_MS = Number(process.env.DEMO_SIM_INTERVAL_MS || 1400);
const SIM_ENABLED_DEFAULT = process.env.DEMO_SIM_ENABLED !== "0";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const dataStore = createDemoDataStore();
const zoneTracker = new ZoneTracker({ inZoneTimeoutMs: IN_ZONE_TIMEOUT_MS });
const cartStore = new CartStore();
const stocktakeStore = new StocktakeStore();
const laundryStore = new LaundryStore();
const EXPECTED_SCAN_KEY = String(
  process.env.DEMO_SCAN_KEY || process.env.SCAN_API_KEY || ""
).trim();

const sseClients = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_err) {
      sseClients.delete(res);
    }
  }
}

zoneTracker.subscribe((event) => broadcast(event));

setInterval(() => {
  zoneTracker.cleanup(Date.now());
}, CLEANUP_INTERVAL_MS).unref();

const demoState = {
  simulatorRunning: false,
  simulatorTimer: null,
};

const knownEpcs = [...dataStore.epcToSku.keys()];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick(list) {
  return list[randomInt(0, list.length - 1)];
}

function normalizeEpc(value) {
  return String(value || "").trim().toUpperCase();
}

function getScanKey(req) {
  return String(
    req.headers["x-scan-key"] ||
      req.headers["x-api-key"] ||
      req.headers["x-xandora-scan-key"] ||
      ""
  ).trim();
}

function hasValidScanKey(req) {
  if (!EXPECTED_SCAN_KEY) return true;
  return getScanKey(req) === EXPECTED_SCAN_KEY;
}

function pickIncomingEpc(raw) {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  return (
    raw.tag ||
    raw.epc ||
    raw.EPC ||
    raw.rfid ||
    raw.rfid_tag ||
    raw.idHex ||
    ""
  );
}

function shouldTreatAsHandheld({ forceHandheld = false, deviceId, bodySource, bodyMode, item }) {
  if (forceHandheld) return true;

  const markers = [
    bodySource,
    bodyMode,
    item?.source,
    item?.mode,
    item?.device_type,
    item?.scanner_type,
    deviceId,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  return /handheld|stocktake|inventory|zebra|rfd|mobile|tc\d{1,3}|mc\d{1,3}|hh/.test(
    markers
  );
}

function mapBatchResponseRows(rows) {
  return rows.map((row) => ({
    epc: row.epc,
    sku: row.item.sku,
    name: row.item.name,
    category: row.item.category,
    source: row.source,
    autoAssigned: row.autoAssigned,
  }));
}

function rememberKnownEpc(epc) {
  const key = normalizeEpc(epc);
  if (key && !knownEpcs.includes(key)) {
    knownEpcs.push(key);
  }
}

function simulatorTick() {
  if (!knownEpcs.length) return;

  const shouldSkip = Math.random() < 0.2;
  if (shouldSkip) return;

  const scanCount = randomInt(1, 3);
  for (let i = 0; i < scanCount; i += 1) {
    const epc = randomPick(knownEpcs);
    const item = dataStore.resolveByEpc(epc);
    if (!item) continue;

    const modeRoll = Math.random();
    if (modeRoll < 0.62) {
      zoneTracker.touch(item, Date.now());
      continue;
    }

    if (modeRoll < 0.84) {
      const row = stocktakeStore.touch(item, {
        device_id: "DEMO_HANDHELD",
        store_id: "STORE_DEMO",
      });
      broadcast({
        type: "inventory.stocktake_scan",
        epc,
        sku: row.sku,
        device_id: row.deviceId,
        store_id: row.storeId,
        scans: row.scans,
        at: Date.now(),
      });
      continue;
    }

    const status = randomPick(["Received", "Washing", "Ready", "Dispatched"]);
    const row = laundryStore.touch(item, {
      status,
      device_id: "DEMO_LAUNDRY_STATION",
      store_id: "STORE_DEMO",
    });
    broadcast({
      type: "laundry.scan",
      epc,
      sku: row.sku,
      status: row.status,
      at: Date.now(),
    });
  }
}

function startSimulator() {
  if (demoState.simulatorRunning) return false;
  demoState.simulatorTimer = setInterval(simulatorTick, SIM_INTERVAL_MS);
  demoState.simulatorRunning = true;
  broadcast({
    type: "demo.simulator.started",
    at: Date.now(),
  });
  return true;
}

function stopSimulator() {
  if (!demoState.simulatorRunning) return false;
  clearInterval(demoState.simulatorTimer);
  demoState.simulatorTimer = null;
  demoState.simulatorRunning = false;
  broadcast({
    type: "demo.simulator.stopped",
    at: Date.now(),
  });
  return true;
}

function clearWorkingState() {
  for (const item of zoneTracker.list()) {
    zoneTracker.remove(item.epc, "clear_working_state", Date.now());
  }
  cartStore.clear();
  stocktakeStore.clear();
  laundryStore.clear();
  broadcast({
    type: "demo.working_state_cleared",
    at: Date.now(),
  });
}

if (SIM_ENABLED_DEFAULT) {
  startSimulator();
}

app.get("/api/health", (_req, res) => {
  const stocktakeSummary = stocktakeStore.summary();
  const laundrySummary = laundryStore.summary();
  res.json({
    ok: true,
    app: "xandora-retail-console",
    uptimeSec: Math.round(process.uptime()),
    liveInZoneCount: zoneTracker.list().length,
    cartCount: cartStore.snapshot().count,
    simulatorRunning: demoState.simulatorRunning,
    stocktakeUniqueEpcs: stocktakeSummary.uniqueEpcs,
    stocktakeTotalScans: stocktakeSummary.totalScanEvents,
    laundryUniqueEpcs: laundrySummary.uniqueEpcs,
  });
});

app.get("/api/demo/status", (_req, res) => {
  const stocktakeSummary = stocktakeStore.summary();
  const laundrySummary = laundryStore.summary();
  res.json({
    app: "xandora-retail-console",
    simulatorRunning: demoState.simulatorRunning,
    inZoneTimeoutMs: IN_ZONE_TIMEOUT_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
    simulatorIntervalMs: SIM_INTERVAL_MS,
    products: dataStore.products.length,
    knownEpcs: knownEpcs.length,
    stocktakeUniqueEpcs: stocktakeSummary.uniqueEpcs,
    stocktakeTotalScans: stocktakeSummary.totalScanEvents,
    laundryUniqueEpcs: laundrySummary.uniqueEpcs,
  });
});

app.post("/api/demo/simulator/start", (_req, res) => {
  const started = startSimulator();
  res.json({
    ok: true,
    simulatorRunning: demoState.simulatorRunning,
    changed: started,
  });
});

app.post("/api/demo/simulator/stop", (_req, res) => {
  const stopped = stopSimulator();
  clearWorkingState();
  res.json({
    ok: true,
    simulatorRunning: demoState.simulatorRunning,
    changed: stopped,
    cleared: true,
  });
});

app.post("/api/demo/clear-working-state", (_req, res) => {
  clearWorkingState();
  res.json({ ok: true, cleared: true });
});

app.post("/api/demo/shutdown", (_req, res) => {
  res.json({ ok: true, shuttingDown: true });
  setTimeout(() => process.exit(0), 450);
});

app.get("/api/live/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "live.connected", at: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.get("/api/live/in-zone", (_req, res) => {
  res.json({
    items: zoneTracker.list(),
    count: zoneTracker.list().length,
  });
});

app.post("/api/live/scan", (req, res) => {
  const epc = normalizeEpc(req.body?.epc);
  if (!epc) {
    return res.status(400).json({ error: "epc is required" });
  }

  const knownBefore = dataStore.epcToSku.has(epc);
  const resolved = dataStore.resolveOrAssignByEpc(epc, { persist: true });
  if (!resolved?.item) {
    return res.status(500).json({ error: "Unable to map EPC to a product" });
  }

  if (!knownBefore) {
    rememberKnownEpc(epc);
    broadcast({
      type: "live.auto_assigned",
      epc,
      sku: resolved.item.sku,
      at: Date.now(),
    });
  }

  const seen = zoneTracker.touch(resolved.item, Date.now());
  return res.json({
    ok: true,
    item: seen,
    autoAssigned: resolved.autoAssigned,
  });
});

function ingestScanBatch(req, res, { forceHandheld = false } = {}) {
  if (!hasValidScanKey(req)) {
    return res.status(403).json({ ok: false, error: "Invalid scan key" });
  }

  const deviceId = String(req.body?.device_id || req.body?.deviceId || "RFID_DEVICE").trim();
  const storeId = String(req.body?.store_id || req.body?.storeId || "STORE_DEMO").trim();
  const bodySource = String(req.body?.source || "").trim();
  const bodyMode = String(req.body?.mode || "").trim();
  const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!itemsRaw.length) {
    return res.status(400).json({ ok: false, error: "items array is required" });
  }

  const processed = [];
  let autoAssignedCount = 0;
  let handheldCount = 0;
  let fixedCount = 0;

  for (const itemRaw of itemsRaw) {
    const epc = normalizeEpc(pickIncomingEpc(itemRaw));
    if (!epc) continue;

    const knownBefore = dataStore.epcToSku.has(epc);
    const resolved = dataStore.resolveOrAssignByEpc(epc, { persist: true });
    if (!resolved?.item) continue;

    if (!knownBefore) {
      rememberKnownEpc(epc);
      autoAssignedCount += 1;
      broadcast({
        type: "live.auto_assigned",
        epc,
        sku: resolved.item.sku,
        at: Date.now(),
      });
    }

    const isHandheld = shouldTreatAsHandheld({
      forceHandheld,
      deviceId,
      bodySource,
      bodyMode,
      item: itemRaw,
    });

    if (isHandheld) {
      const row = stocktakeStore.touch(resolved.item, {
        device_id: deviceId,
        store_id: storeId,
      });
      handheldCount += 1;
      broadcast({
        type: "inventory.stocktake_scan",
        epc,
        sku: row.sku,
        device_id: deviceId,
        store_id: storeId,
        scans: row.scans,
        at: Date.now(),
      });
      processed.push({
        epc,
        item: resolved.item,
        source: "handheld",
        autoAssigned: resolved.autoAssigned,
      });
    } else {
      zoneTracker.touch(resolved.item, Date.now());
      fixedCount += 1;
      processed.push({
        epc,
        item: resolved.item,
        source: "fixed_reader",
        autoAssigned: resolved.autoAssigned,
      });
    }
  }

  if (!processed.length) {
    return res.status(400).json({ ok: false, error: "No valid EPC rows in batch" });
  }

  return res.json({
    ok: true,
    received: itemsRaw.length,
    processed: processed.length,
    device_id: deviceId,
    store_id: storeId,
    fixed_reader_scans: fixedCount,
    handheld_scans: handheldCount,
    auto_assigned: autoAssignedCount,
    rows: mapBatchResponseRows(processed),
  });
}

app.post("/api/v1/scans/batch", (req, res) => ingestScanBatch(req, res, { forceHandheld: false }));
app.post("/api/v1/handheld/stocktake/batch", (req, res) =>
  ingestScanBatch(req, res, { forceHandheld: true })
);
app.post("/api/inventory/stocktake/scan", (req, res) =>
  ingestScanBatch(
    {
      ...req,
      body: {
        device_id: req.body?.device_id || "ZEBRA_HANDHELD",
        store_id: req.body?.store_id || "STORE_DEMO",
        source: "handheld",
        mode: "stocktake",
        items: [{ epc: req.body?.epc }],
      },
    },
    res,
    { forceHandheld: true }
  )
);

app.get("/api/assignments", (_req, res) => {
  const includeSeed = demoState.simulatorRunning;
  const items = dataStore.listAssignments({ includeSeed });
  res.json({
    items,
    count: items.length,
    include_seed_demo_items: includeSeed,
  });
});

app.get("/api/assignments/recent-epcs", (_req, res) => {
  const liveRows = zoneTracker.list().map((item) => ({
    epc: item.epc,
    source: "Bin live zone",
    seenAt: item.lastSeenAt,
    ageSec: item.ageSec,
    assigned: dataStore.isAssigned(item.epc),
    item: dataStore.resolveByEpc(item.epc),
  }));

  const stocktakeRows = stocktakeStore.recent(40).map((item) => ({
    epc: item.epc,
    source: "Inventory intake",
    seenAt: item.at,
    assigned: dataStore.isAssigned(item.epc),
    item: dataStore.resolveByEpc(item.epc),
  }));

  const laundryRows = laundryStore.recent(40).map((item) => ({
    epc: item.epc,
    source: "Laundry",
    seenAt: item.at,
    assigned: dataStore.isAssigned(item.epc),
    item: dataStore.resolveByEpc(item.epc),
  }));

  const byEpc = new Map();
  for (const row of [...liveRows, ...stocktakeRows, ...laundryRows]) {
    const key = normalizeEpc(row.epc);
    if (!key) continue;
    const prev = byEpc.get(key);
    if (!prev || Number(row.seenAt || 0) > Number(prev.seenAt || 0)) {
      byEpc.set(key, { ...row, epc: key });
    }
  }

  const items = [...byEpc.values()]
    .sort((a, b) => Number(b.seenAt || 0) - Number(a.seenAt || 0))
    .slice(0, 30)
    .map((row) => ({
      ...row,
      seenAtIso: row.seenAt ? new Date(row.seenAt).toISOString() : null,
    }));

  res.json({
    items,
    count: items.length,
  });
});

app.post("/api/assignments", (req, res) => {
  const assigned = dataStore.assignEpc(req.body || {});
  if (!assigned) {
    return res.status(400).json({ ok: false, error: "epc, sku, and product name are required" });
  }

  rememberKnownEpc(assigned.epc);
  broadcast({
    type: "assignment.saved",
    epc: assigned.epc,
    sku: assigned.sku,
    at: Date.now(),
  });

  return res.json({ ok: true, item: assigned });
});

app.get("/api/laundry/items", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 300);
  res.json({
    items: laundryStore.list().slice(0, limit),
    recent: laundryStore.recent(limit),
    summary: laundryStore.summary(),
  });
});

app.post("/api/laundry/scan", (req, res) => {
  const epc = normalizeEpc(req.body?.epc);
  if (!epc) {
    return res.status(400).json({ ok: false, error: "epc is required" });
  }

  const resolved = dataStore.resolveOrAssignByEpc(epc, { persist: true });
  if (!resolved?.item) {
    return res.status(500).json({ ok: false, error: "Unable to map EPC to a laundry item" });
  }

  rememberKnownEpc(epc);
  const row = laundryStore.touch(resolved.item, {
    status: req.body?.status || "Received",
    device_id: req.body?.device_id || "LAUNDRY_STATION",
    store_id: req.body?.store_id || "STORE_DEMO",
  });

  broadcast({
    type: "laundry.scan",
    epc,
    sku: row.sku,
    status: row.status,
    at: Date.now(),
  });

  return res.json({ ok: true, item: row, autoAssigned: resolved.autoAssigned });
});

app.post("/api/laundry/clear", (_req, res) => {
  const summary = laundryStore.clear();
  broadcast({
    type: "laundry.cleared",
    at: Date.now(),
  });
  res.json({ ok: true, summary });
});

app.post("/api/live/remove", (req, res) => {
  const epc = String(req.body?.epc || "").trim();
  if (!epc) {
    return res.status(400).json({ error: "epc is required" });
  }

  const removed = zoneTracker.remove(epc, "manual", Date.now());
  return res.json({
    ok: true,
    removed,
  });
});

app.get("/api/catalog/products", (_req, res) => {
  res.json({
    items: dataStore.products,
    count: dataStore.products.length,
  });
});

app.get("/api/inventory/summary", (_req, res) => {
  const inZoneBySku = zoneTracker.countBySku();
  const stocktakeBySku = stocktakeStore.countBySku();
  const products = dataStore.listProducts({
    includeSeed: demoState.simulatorRunning,
  });
  const items = products.map((product) => {
    const inZone = Number(inZoneBySku[product.sku] || 0);
    const stocktakeScanned = Number(stocktakeBySku[product.sku] || 0);
    const stock = Number(product.stock || 0);
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      currency: product.currency || "LKR",
      unitPrice: Number(product.price || 0),
      stock,
      inZone,
      stocktakeScanned,
      available: Math.max(stock - inZone, 0),
    };
  });

  res.json({
    items,
    count: items.length,
    stocktake: stocktakeStore.summary(),
    include_seed_demo_items: demoState.simulatorRunning,
  });
});

app.get("/api/inventory/stocktake/recent", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 300);
  res.json({
    items: stocktakeStore.recent(limit),
    summary: stocktakeStore.summary(),
  });
});

app.post("/api/inventory/stocktake/clear", (_req, res) => {
  const summary = stocktakeStore.clear();
  broadcast({
    type: "inventory.stocktake_cleared",
    at: Date.now(),
  });
  res.json({
    ok: true,
    summary,
  });
});

app.get("/api/pos/cart", (_req, res) => {
  res.json(cartStore.snapshot());
});

app.post("/api/pos/cart/add", (req, res) => {
  const epc = String(req.body?.epc || "").trim();
  if (!epc) {
    return res.status(400).json({ error: "epc is required" });
  }

  const liveItem = zoneTracker.list().find((item) => item.epc === epc);
  const catalogItem = dataStore.resolveByEpc(epc);
  const item = liveItem || catalogItem;

  if (!item) {
    return res.status(404).json({ error: `Unknown EPC: ${epc}` });
  }

  return res.json(cartStore.add(item));
});

app.post("/api/pos/cart/remove", (req, res) => {
  const epc = String(req.body?.epc || "").trim();
  if (!epc) {
    return res.status(400).json({ error: "epc is required" });
  }
  return res.json(cartStore.remove(epc));
});

app.post("/api/pos/cart/clear", (_req, res) => {
  return res.json(cartStore.clear());
});

const frontendRoot = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendRoot));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(frontendRoot, "index.html"));
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[xandora-retail-console] running at http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
});
