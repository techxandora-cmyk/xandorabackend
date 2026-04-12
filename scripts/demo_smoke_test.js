#!/usr/bin/env node

require("dotenv").config();
const assert = require("node:assert/strict");
const axios = require("axios");

const API_ROOT = String(process.env.SMOKE_API_ROOT || "http://127.0.0.1:3000").replace(
  /\/+$/,
  ""
);
const API_BASE = `${API_ROOT}/api/v1`;

const DEMO = {
  email: String(process.env.DEMO_ADMIN_EMAIL || "demo.ops@xandora.local")
    .trim()
    .toLowerCase(),
  password: String(process.env.DEMO_ADMIN_PASSWORD || "DemoPass!123"),
  mainStore: String(process.env.DEMO_STORE_ID || "DEMO_MAIN")
    .trim()
    .toUpperCase(),
  outletStore: String(process.env.DEMO_SECONDARY_STORE_ID || "DEMO_OUTLET")
    .trim()
    .toUpperCase(),
};

const STEPS = [];

function headers(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  };
}

function pushStep(name, details) {
  STEPS.push({ name, details });
}

async function login(productKey) {
  const response = await axios.post(
    `${API_BASE}/auth/login`,
    {
      email: DEMO.email,
      password: DEMO.password,
      product_key: productKey,
    },
    { timeout: 15000 }
  );

  assert.equal(response.data?.ok, true, `Login failed for ${productKey}`);
  assert.ok(response.data?.token, `Missing token for ${productKey}`);
  return response.data.token;
}

async function ensureHealth() {
  const response = await axios.get(`${API_ROOT}/api/health/live`, {
    timeout: 10000,
  });
  assert.equal(response.status, 200, "API health probe failed");
  pushStep("API health", { status: response.status });
}

async function smokeRetail(token) {
  const retail = {};

  await axios.post(
    `${API_BASE}/billing/reset`,
    { store_id: DEMO.mainStore },
    headers(token)
  );
  pushStep("Retail reset", { store_id: DEMO.mainStore });

  const barcodeLookup = await axios.get(`${API_BASE}/catalog/lookup`, {
    ...headers(token),
    params: {
      store_id: DEMO.mainStore,
      barcode: "DEMO-BOX-001",
    },
  });
  assert.equal(barcodeLookup.data?.ok, true);
  assert.equal(Number(barcodeLookup.data?.count || 0), 4);
  retail.lookup = {
    barcode: "DEMO-BOX-001",
    count: Number(barcodeLookup.data?.count || 0),
  };
  pushStep("Retail barcode lookup", retail.lookup);

  const assignment = await axios.post(
    `${API_BASE}/catalog/assign-items`,
    {
      store_id: DEMO.mainStore,
      barcode: "DEMO-BOX-001",
      quantity: 2,
      epcs: ["DEMO-RET-0001", "DEMO-RET-0002"],
      device_id: "DEMO_HHT_RETAIL",
    },
    headers(token)
  );
  assert.equal(assignment.data?.ok, true);
  assert.equal(Number(assignment.data?.assignment?.quantity_confirmed || 0), 2);
  retail.assignment = assignment.data.assignment;
  pushStep("Retail assign items", {
    assignment_id: retail.assignment.assignment_id,
    quantity_confirmed: retail.assignment.quantity_confirmed,
  });

  const deviceList = await axios.get(`${API_BASE}/devices`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });
  assert.equal(deviceList.data?.ok, true);
  assert.ok(Number(deviceList.data?.total || 0) >= 1, "Expected demo devices");
  retail.devices = {
    total: Number(deviceList.data.total || 0),
  };
  pushStep("Retail reader health data", retail.devices);

  const start = await axios.post(
    `${API_BASE}/billing/start`,
    {
      store_id: DEMO.mainStore,
      expected_items_count: 4,
      device_id: "DEMO_POS_MAIN",
    },
    headers(token)
  );
  assert.equal(start.data?.ok, true);
  retail.billing_session = start.data.session?.session_id || null;
  pushStep("Retail billing start", {
    session_id: retail.billing_session,
  });

  const matched = await axios.post(
    `${API_BASE}/billing/scan`,
    {
      store_id: DEMO.mainStore,
      epc: "DEMO-RET-0001",
      device_id: "DEMO_POS_MAIN",
    },
    headers(token)
  );
  assert.equal(matched.data?.validation?.validation_status, "MATCHED");

  const duplicate = await axios.post(
    `${API_BASE}/billing/scan`,
    {
      store_id: DEMO.mainStore,
      epc: "DEMO-RET-0001",
      device_id: "DEMO_POS_MAIN",
    },
    headers(token)
  );
  assert.equal(duplicate.data?.validation?.validation_status, "DUPLICATE");

  const alreadyBilled = await axios.post(
    `${API_BASE}/billing/scan`,
    {
      store_id: DEMO.mainStore,
      epc: "DEMO-RET-0004",
      device_id: "DEMO_POS_MAIN",
    },
    headers(token)
  );
  assert.equal(alreadyBilled.data?.validation?.validation_status, "ALREADY_BILLED");

  const unknown = await axios.post(
    `${API_BASE}/billing/scan`,
    {
      store_id: DEMO.mainStore,
      epc: "DEMO-RET-9999",
      device_id: "DEMO_POS_MAIN",
    },
    headers(token)
  );
  assert.equal(unknown.data?.validation?.validation_status, "UNKNOWN_EPC");

  const summary = await axios.get(`${API_BASE}/billing/summary`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });

  assert.equal(summary.data?.ok, true);
  assert.equal(Number(summary.data?.summary?.matched_items_count || 0), 0);
  assert.equal(Number(summary.data?.summary?.scanned_items_count || 0), 3);
  assert.equal(Number(summary.data?.summary?.duplicate_count || 0), 1);
  assert.equal(Number(summary.data?.summary?.already_billed_count || 0), 1);
  assert.equal(Number(summary.data?.summary?.unknown_count || 0), 1);
  retail.billing_summary = summary.data.summary;
  pushStep("Retail billing validation statuses", retail.billing_summary);

  const billingComplete = await axios.post(
    `${API_BASE}/billing/complete`,
    { store_id: DEMO.mainStore },
    headers(token)
  );
  assert.equal(billingComplete.data?.ok, true);
  pushStep("Retail billing complete", {
    status: billingComplete.data?.session?.status || null,
  });

  const transfer = await axios.post(
    `${API_BASE}/catalog/transfer`,
    {
      source_store_id: DEMO.mainStore,
      destination_store_id: DEMO.outletStore,
      epcs: ["DEMO-RET-0003"],
      device_id: "DEMO_HHT_RETAIL",
    },
    headers(token)
  );
  assert.equal(transfer.data?.ok, true);
  retail.transfer = transfer.data.transfer;
  pushStep("Retail transfer", {
    transfer_id: retail.transfer.transfer_id,
    moved_count: retail.transfer.moved_count,
  });

  const destinationLookup = await axios.get(`${API_BASE}/catalog/lookup`, {
    ...headers(token),
    params: {
      store_id: DEMO.outletStore,
      epc: "DEMO-RET-0003",
    },
  });
  assert.equal(destinationLookup.data?.found, true);
  pushStep("Retail transferred item lookup", {
    store_id: DEMO.outletStore,
    epc: "DEMO-RET-0003",
    found: destinationLookup.data?.found,
  });

  return retail;
}

async function smokeLaundry(token) {
  const laundry = {};

  const summary = await axios.get(`${API_BASE}/laundry/summary`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });
  assert.equal(summary.data?.ok, true);
  assert.ok(Number(summary.data?.summary?.total_items || 0) >= 6);
  laundry.summary = summary.data.summary;
  pushStep("Laundry summary", laundry.summary);

  const itemTypes = await axios.get(`${API_BASE}/laundry/item-types`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });
  assert.equal(itemTypes.data?.ok, true);
  assert.ok(Array.isArray(itemTypes.data?.item_types));
  assert.ok(itemTypes.data.item_types.length >= 2);
  const firstTypeId = Number(itemTypes.data.item_types[0].id);
  pushStep("Laundry item types", {
    count: itemTypes.data.item_types.length,
  });

  const register = await axios.post(
    `${API_BASE}/laundry/items/register`,
    {
      store_id: DEMO.mainStore,
      epc: "DEMO-LAU-NEW-001",
      item_type_id: firstTypeId,
      current_location: "Laundry intake",
      assigned_to: "Demo Suite",
      notes: "Smoke test register",
    },
    headers(token)
  );
  assert.equal(register.data?.ok, true);
  pushStep("Laundry register fabric", {
    epc: register.data?.item?.epc || null,
  });

  const receive = await axios.post(
    `${API_BASE}/laundry/actions`,
    {
      store_id: DEMO.mainStore,
      action: "receive",
      epcs: ["DEMO-LAU-OUT-001"],
      location_label: "Front desk",
      notes: "Returned from guest",
    },
    headers(token)
  );
  assert.equal(receive.data?.ok, true);
  pushStep("Laundry receive", {
    processed: receive.data?.processed || 0,
  });

  const washStart = await axios.post(
    `${API_BASE}/laundry/actions`,
    {
      store_id: DEMO.mainStore,
      action: "wash_start",
      epcs: ["DEMO-LAU-IN-001"],
      location_label: "Washer 2",
      notes: "Wash cycle started",
    },
    headers(token)
  );
  assert.equal(washStart.data?.ok, true);

  const washComplete = await axios.post(
    `${API_BASE}/laundry/actions`,
    {
      store_id: DEMO.mainStore,
      action: "wash_complete",
      epcs: ["DEMO-LAU-IN-001"],
      location_label: "Clean stock",
      cycle_increment: 1,
      notes: "Wash complete",
    },
    headers(token)
  );
  assert.equal(washComplete.data?.ok, true);
  pushStep("Laundry wash flow", {
    processed: washComplete.data?.processed || 0,
  });

  const damaged = await axios.post(
    `${API_BASE}/laundry/actions`,
    {
      store_id: DEMO.mainStore,
      action: "mark_damaged",
      epcs: ["DEMO-LAU-DMG-001"],
      notes: "Frayed edge",
    },
    headers(token)
  );
  assert.equal(damaged.data?.ok, true);
  pushStep("Laundry exception", {
    action: "mark_damaged",
    processed: damaged.data?.processed || 0,
  });

  const damagedItems = await axios.get(`${API_BASE}/laundry/items`, {
    ...headers(token),
    params: {
      store_id: DEMO.mainStore,
      status: "DAMAGED",
      limit: 20,
    },
  });
  assert.equal(damagedItems.data?.ok, true);
  assert.ok(
    Array.isArray(damagedItems.data?.items) &&
      damagedItems.data.items.some((item) => item.epc === "DEMO-LAU-DMG-001")
  );
  pushStep("Laundry damaged filter", {
    count: Array.isArray(damagedItems.data?.items) ? damagedItems.data.items.length : 0,
  });

  const events = await axios.get(`${API_BASE}/laundry/events`, {
    ...headers(token),
    params: {
      store_id: DEMO.mainStore,
      limit: 20,
    },
  });
  assert.equal(events.data?.ok, true);
  assert.ok(Array.isArray(events.data?.events) && events.data.events.length >= 4);
  pushStep("Laundry events", {
    count: events.data.events.length,
  });

  return laundry;
}

async function smokeStockAudit(token) {
  const stockAudit = {};

  await axios.post(
    `${API_BASE}/inventory/reset`,
    { store_id: DEMO.mainStore },
    headers(token)
  );
  pushStep("Stock audit reset", { store_id: DEMO.mainStore });

  const start = await axios.post(
    `${API_BASE}/inventory/start`,
    {
      store_id: DEMO.mainStore,
      total_expected: 3,
      device_id: "DEMO_HHT_AUDIT",
    },
    headers(token)
  );
  assert.equal(start.data?.ok, true);
  stockAudit.session_id = start.data?.session?.session_id || null;
  pushStep("Stock audit start", {
    session_id: stockAudit.session_id,
  });

  const scan = await axios.post(
    `${API_BASE}/inventory/scan`,
    {
      store_id: DEMO.mainStore,
      epcs: ["DEMO-RET-0001", "DEMO-RET-0002"],
      device_id: "DEMO_HHT_AUDIT",
    },
    headers(token)
  );
  assert.equal(scan.data?.ok, true);
  assert.equal(Number(scan.data?.scanned_count || 0), 2);
  pushStep("Stock audit scan", {
    scanned_count: scan.data.scanned_count,
  });

  const progress = await axios.get(`${API_BASE}/inventory/progress`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });
  assert.equal(progress.data?.ok, true);
  assert.equal(Number(progress.data?.found || 0), 2);
  assert.equal(Number(progress.data?.expected || 0), 3);
  assert.equal(Number(progress.data?.missing || 0), 1);
  stockAudit.progress = progress.data;
  pushStep("Stock audit progress", {
    found: progress.data.found,
    expected: progress.data.expected,
    missing: progress.data.missing,
  });

  const items = await axios.get(`${API_BASE}/inventory/items`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore, limit: 20 },
  });
  assert.equal(items.data?.ok, true);
  assert.ok(Array.isArray(items.data?.items) && items.data.items.length >= 2);
  pushStep("Stock audit items", {
    count: items.data.items.length,
    source: items.data.source,
  });

  const end = await axios.post(
    `${API_BASE}/inventory/end`,
    { store_id: DEMO.mainStore },
    headers(token)
  );
  assert.equal(end.data?.ok, true);
  pushStep("Stock audit complete", {
    status: end.data?.session?.status || null,
  });

  const history = await axios.get(`${API_BASE}/inventory/history`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });
  assert.equal(history.data?.ok, true);
  assert.ok(Array.isArray(history.data?.sessions) && history.data.sessions.length >= 1);
  pushStep("Stock audit history", {
    count: history.data.sessions.length,
  });

  return stockAudit;
}

async function smokeAlerts(token) {
  const alerts = await axios.get(`${API_BASE}/alerts`, {
    ...headers(token),
    params: { store_id: DEMO.mainStore },
  });

  assert.equal(alerts.data?.ok, true);
  assert.ok(Array.isArray(alerts.data?.alerts));

  const types = alerts.data.alerts.map((alert) => alert.type);
  assert.ok(types.includes("UNKNOWN_EPC_DETECTED"));
  assert.ok(types.includes("DUPLICATE_SCAN_BEHAVIOR"));
  assert.ok(types.includes("ITEM_ALREADY_BILLED"));
  assert.ok(types.includes("MISSING_EXPECTED_ITEMS"));

  pushStep("Alerts feed", {
    total: alerts.data.alerts.length,
    types,
  });

  return {
    total: alerts.data.alerts.length,
    types,
  };
}

async function main() {
  await ensureHealth();

  const retailToken = await login("retail");
  pushStep("Login retail module", {
    email: DEMO.email,
    store_id: DEMO.mainStore,
  });

  const laundryToken = await login("laundry");
  pushStep("Login laundry module", {
    email: DEMO.email,
    store_id: DEMO.mainStore,
  });

  const stockAuditToken = await login("stock_audit");
  pushStep("Login stock audit module", {
    email: DEMO.email,
    store_id: DEMO.mainStore,
  });

  const retail = await smokeRetail(retailToken);
  const laundry = await smokeLaundry(laundryToken);
  const stockAudit = await smokeStockAudit(stockAuditToken);
  const alerts = await smokeAlerts(retailToken);

  console.log(
    JSON.stringify(
      {
        ok: true,
        demo_user: {
          email: DEMO.email,
          password: DEMO.password,
          stores: [DEMO.mainStore, DEMO.outletStore],
        },
        api_root: API_ROOT,
        modules: {
          retail,
          laundry,
          stock_audit: stockAudit,
          alerts,
        },
        steps: STEPS,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err?.response?.data || err?.message || String(err),
        steps: STEPS,
      },
      null,
      2
    )
  );
  process.exit(1);
});
