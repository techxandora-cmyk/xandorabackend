const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");

const { ZoneTracker } = require("./services/zoneTracker");
const { CartStore } = require("./services/cartStore");
const { StocktakeStore } = require("./services/stocktakeStore");

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || "0.0.0.0";
const MAIN_API_URL = String(
  process.env.RETAIL_BACKEND_URL || process.env.MAIN_API_URL || ""
).trim().replace(/\/+$/, "");
const RETAIL_DEVICE_ID = String(
  process.env.RETAIL_DEVICE_ID || "RETAIL_CONSOLE_01"
).trim();
const IN_ZONE_TIMEOUT_MS = Number(process.env.DEMO_IN_ZONE_TIMEOUT_MS || 300000);
const RECENT_EPC_TTL_MS = 10 * 60 * 1000;
const SESSION_IDLE_MS = Math.max(
  Number(process.env.RETAIL_SESSION_IDLE_MS || 12 * 60 * 60 * 1000),
  30 * 60 * 1000
);

if (!MAIN_API_URL) {
  throw new Error("RETAIL_BACKEND_URL or MAIN_API_URL is required for retail real mode");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const sessions = new Map();

function normalizeEpc(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreId(value) {
  return String(value || "").trim().toUpperCase();
}

function createSessionId() {
  return crypto.randomBytes(24).toString("hex");
}

function parseJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function parseJwtExpiry(token) {
  const payload = parseJwtPayload(token);
  return Number(payload?.exp || 0);
}

function createRetailState() {
  const zoneTracker = new ZoneTracker({ inZoneTimeoutMs: IN_ZONE_TIMEOUT_MS });
  const state = {
    zoneTracker,
    cartStore: new CartStore(),
    stocktakeStore: new StocktakeStore(),
    recentLiveEpcs: new Map(),
    sseClients: new Set(),
  };

  zoneTracker.subscribe((event) => {
    broadcastToState(state, event);
  });

  return state;
}

function sessionSummary(session) {
  return {
    ok: true,
    authenticated: true,
    mode: "real",
    session_id: session.id,
    user: session.user,
    stores: session.storeIds,
    selected_store_id: session.selectedStoreId || null,
    products: session.products,
  };
}

function broadcastToState(state, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of state.sseClients) {
    try {
      res.write(payload);
    } catch (_err) {
      state.sseClients.delete(res);
    }
  }
}

function rememberRecentEpc(state, epc, extra = {}) {
  const normalized = normalizeEpc(epc);
  if (!normalized) return;
  state.recentLiveEpcs.set(normalized, {
    epc: normalized,
    seenAt: Date.now(),
    ...extra,
  });
}

async function backendFetch(pathname, options = {}) {
  const response = await fetch(`${MAIN_API_URL}${pathname}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(body?.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function loginProduct(email, password, productKey) {
  const body = await backendFetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      product_key: productKey,
    }),
  });

  const token = String(body?.token || "").trim();
  if (!token) {
    throw new Error(`No token returned for product ${productKey}`);
  }

  return token;
}

async function loginAvailableProducts(email, password) {
  const tokens = {};
  const products = [];

  const retailToken = await loginProduct(email, password, "retail");
  tokens.retail = retailToken;
  products.push("retail");

  for (const productKey of ["stock_audit", "laundry"]) {
    try {
      const token = await loginProduct(email, password, productKey);
      tokens[productKey] = token;
      products.push(productKey);
    } catch (_err) {
      // Product not enabled for this account; keep optional.
    }
  }

  return { tokens, products };
}

async function authorizedFetch(session, productKey, pathname, options = {}) {
  const token = session.tokens[productKey];
  if (!token) {
    throw new Error(`Product access not enabled for ${productKey}`);
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  if (options.body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return backendFetch(pathname, {
    ...options,
    headers,
  });
}

function requireSession(req, res, next) {
  const sessionId = String(
    req.headers["x-retail-session"] || req.query.session_id || ""
  ).trim();
  if (!sessionId) {
    return res.status(401).json({ ok: false, error: "Retail session required" });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Retail session expired" });
  }

  session.lastSeenAt = Date.now();
  req.retailSession = session;
  return next();
}

function requireSelectedStore(req, res, next) {
  if (!req.retailSession?.selectedStoreId) {
    return res.status(400).json({ ok: false, error: "Select a store first" });
  }
  return next();
}

function toAssignmentItem(item = {}) {
  return {
    epc: item.epc,
    sku: item.sku || "",
    name: item.product_name || item.name || "",
    category: item.category || "",
    bin: item.bin || "",
    size: item.size_label || "",
    color: item.color || "",
    price: Number(item.price_lkr || 0),
    currency: "LKR",
    stock: item.stock != null ? Number(item.stock) : 1,
    laundryStatus: item.laundry_status || "",
    notes: item.notes || "",
    barcode: item.barcode || "",
  };
}

function toZoneItem(item = {}) {
  return {
    epc: item.epc,
    sku: item.sku || "",
    name: item.name || "",
    category: item.category || "",
    bin: item.bin || "",
    size: item.size || "",
    color: item.color || "",
    price: Number(item.price || 0),
    currency: item.currency || "LKR",
  };
}

async function fetchCatalog(session, limit = 1000) {
  const body = await authorizedFetch(
    session,
    "retail",
    `/api/v1/catalog?store_id=${encodeURIComponent(session.selectedStoreId)}&limit=${limit}`
  );
  return Array.isArray(body?.items) ? body.items.map(toAssignmentItem) : [];
}

async function lookupCatalogItem(session, epc) {
  const normalized = normalizeEpc(epc);
  if (!normalized) return null;
  const body = await authorizedFetch(
    session,
    "retail",
    `/api/v1/catalog/lookup?store_id=${encodeURIComponent(
      session.selectedStoreId
    )}&epc=${encodeURIComponent(normalized)}`
  );
  return body?.found && body.item ? toAssignmentItem(body.item) : null;
}

async function ingestLiveScan(session, epc) {
  const normalized = normalizeEpc(epc);
  if (!normalized) {
    throw new Error("epc is required");
  }

  await authorizedFetch(session, "retail", "/api/v1/scans/batch", {
    method: "POST",
    body: JSON.stringify({
      device_id: RETAIL_DEVICE_ID,
      store_id: session.selectedStoreId,
      items: [{ epc: normalized }],
    }),
  });

  const item = await lookupCatalogItem(session, normalized);
  rememberRecentEpc(session.state, normalized, {
    source: "Manual scan",
    assigned: Boolean(item),
    item,
  });

  if (item) {
    session.state.zoneTracker.touch(toZoneItem(item), Date.now());
  }

  broadcastToState(session.state, {
    type: "live.scan",
    epc: normalized,
    at: Date.now(),
  });

  return item;
}

async function ensureStocktakeSession(session) {
  const active = await authorizedFetch(
    session,
    "stock_audit",
    `/api/v1/inventory/active?store_id=${encodeURIComponent(session.selectedStoreId)}`
  );
  if (active?.session) return active.session;

  const started = await authorizedFetch(session, "stock_audit", "/api/v1/inventory/start", {
    method: "POST",
    body: JSON.stringify({
      store_id: session.selectedStoreId,
      device_id: RETAIL_DEVICE_ID,
      total_expected: 0,
    }),
  });
  return started?.session || null;
}

function mapLaundryStatusToAction(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "washing") return "wash_start";
  if (value === "dispatched") return "dispatch";
  if (value === "ready") return "receive";
  return "receive";
}

function mapLaundrySummary(items = []) {
  const byStatus = {};
  for (const item of items) {
    const key = String(item.status || "UNKNOWN");
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  return {
    uniqueEpcs: items.length,
    totalScanEvents: items.length,
    byStatus,
  };
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [sessionId, session] of sessions.entries()) {
    if (Number(session.lastSeenAt || 0) < cutoff) {
      sessions.delete(sessionId);
      continue;
    }

    const recentCutoff = Date.now() - RECENT_EPC_TTL_MS;
    for (const [epc, row] of session.state.recentLiveEpcs.entries()) {
      if (Number(row.seenAt || 0) < recentCutoff) {
        session.state.recentLiveEpcs.delete(epc);
      }
    }

    session.state.zoneTracker.cleanup(Date.now());
  }
}

setInterval(cleanupSessions, 60 * 1000).unref();

function startLiveBridge() {
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  };

  const connect = () => {
    let url;
    try {
      url = new URL("/api/v1/events/stream", MAIN_API_URL);
    } catch (_err) {
      return;
    }

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(
      url.toString(),
      { headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          scheduleReconnect();
          return;
        }

        let buffer = "";
        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          buffer += chunk;
          const parts = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n\n");
          buffer = parts.pop() || "";

          for (const block of parts) {
            let eventName = "";
            let dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataStr += line.slice(5).trim();
              }
            }

            if (!dataStr) continue;

            let data;
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }

            const upstreamStoreId = normalizeStoreId(
              data.store_id || data.storeId || data.store || ""
            );
            if (!upstreamStoreId) continue;

            for (const session of sessions.values()) {
              if (normalizeStoreId(session.selectedStoreId) !== upstreamStoreId) continue;

              const epc = normalizeEpc(data.tag || data.epc || "");
              if (!epc) continue;

              lookupCatalogItem(session, epc)
                .then((item) => {
                  rememberRecentEpc(session.state, epc, {
                    source: eventName === "scan" ? "Live reader" : "Zone heartbeat",
                    assigned: Boolean(item),
                    item,
                  });

                  if (item) {
                    session.state.zoneTracker.touch(toZoneItem(item), Date.now());
                  }

                  if (eventName === "scan") {
                    broadcastToState(session.state, {
                      type: "live.scan",
                      epc,
                      at: Date.now(),
                    });
                  }
                })
                .catch(() => {});
            }
          }
        });

        res.on("end", scheduleReconnect);
        res.on("error", scheduleReconnect);
      }
    );

    req.on("error", scheduleReconnect);
    req.setTimeout(0);
  };

  connect();
}

startLiveBridge();

app.post("/api/session/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const requestedStoreId = normalizeStoreId(req.body?.store_id);

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password required" });
    }

    const { tokens, products } = await loginAvailableProducts(email, password);
    const retailPayload = parseJwtPayload(tokens.retail);
    const storeIds = Array.from(
      new Set((Array.isArray(retailPayload?.store_ids) ? retailPayload.store_ids : []).map(normalizeStoreId).filter(Boolean))
    );

    if (!storeIds.length) {
      return res.status(403).json({ ok: false, error: "No store access on this account" });
    }

    const sessionId = createSessionId();
    const selectedStoreId = requestedStoreId && storeIds.includes(requestedStoreId)
      ? requestedStoreId
      : storeIds.length === 1
      ? storeIds[0]
      : null;

    const session = {
      id: sessionId,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      user: {
        email: retailPayload?.email || email,
        company_name: retailPayload?.company_name || null,
        roles: Array.isArray(retailPayload?.roles) ? retailPayload.roles : [],
      },
      tokens,
      products,
      storeIds,
      selectedStoreId,
      state: createRetailState(),
    };

    sessions.set(sessionId, session);

    return res.json({
      ok: true,
      session_id: sessionId,
      needs_store_selection: !selectedStoreId,
      ...sessionSummary(session),
    });
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }
});

app.get("/api/session/status", requireSession, (req, res) => {
  return res.json(sessionSummary(req.retailSession));
});

app.post("/api/session/select-store", requireSession, async (req, res) => {
  const storeId = normalizeStoreId(req.body?.store_id);
  if (!storeId) {
    return res.status(400).json({ ok: false, error: "store_id required" });
  }
  if (!req.retailSession.storeIds.includes(storeId)) {
    return res.status(403).json({ ok: false, error: "Store not allowed" });
  }

  req.retailSession.selectedStoreId = storeId;
  req.retailSession.state = createRetailState();
  return res.json(sessionSummary(req.retailSession));
});

app.post("/api/session/logout", requireSession, (req, res) => {
  sessions.delete(req.retailSession.id);
  return res.json({ ok: true });
});

app.get("/api/health", async (_req, res) => {
  try {
    const health = await backendFetch("/api/health");
    return res.json({
      ok: true,
      app: "xandora-retail-console",
      mode: "real",
      upstream: health,
      session_count: sessions.size,
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      app: "xandora-retail-console",
      mode: "real",
      error: err.message,
    });
  }
});

app.get("/api/demo/status", requireSession, (req, res) => {
  return res.json({
    app: "xandora-retail-console",
    mode: "real",
    simulatorRunning: false,
    bridge: {
      configured: true,
      connected: true,
      mainApiUrl: MAIN_API_URL,
    },
    store_id: req.retailSession.selectedStoreId || null,
    products: req.retailSession.products,
  });
});

app.post("/api/demo/simulator/start", (_req, res) =>
  res.status(400).json({ ok: false, error: "Simulator disabled in real mode" })
);
app.post("/api/demo/simulator/stop", (_req, res) =>
  res.status(400).json({ ok: false, error: "Simulator disabled in real mode" })
);

app.post("/api/demo/clear-working-state", requireSession, (req, res) => {
  req.retailSession.state.cartStore.clear();
  for (const item of req.retailSession.state.zoneTracker.list()) {
    req.retailSession.state.zoneTracker.remove(item.epc, "manual", Date.now());
  }
  req.retailSession.state.stocktakeStore.clear();
  return res.json({ ok: true, cleared: true });
});

app.post("/api/demo/shutdown", (_req, res) =>
  res.json({ ok: true, shuttingDown: false })
);

app.get("/api/live/events", requireSession, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "live.connected", at: Date.now() })}\n\n`);
  req.retailSession.state.sseClients.add(res);
  req.on("close", () => req.retailSession.state.sseClients.delete(res));
});

app.get("/api/live/in-zone", requireSession, requireSelectedStore, (req, res) => {
  const items = req.retailSession.state.zoneTracker.list();
  return res.json({ items, count: items.length });
});

app.post("/api/live/scan", requireSession, requireSelectedStore, async (req, res) => {
  try {
    const item = await ingestLiveScan(req.retailSession, req.body?.epc);
    return res.json({
      ok: true,
      epc: normalizeEpc(req.body?.epc),
      assigned: Boolean(item),
      item,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/live/remove", requireSession, requireSelectedStore, (req, res) => {
  const epc = normalizeEpc(req.body?.epc);
  if (!epc) {
    return res.status(400).json({ ok: false, error: "epc is required" });
  }
  const removed = req.retailSession.state.zoneTracker.remove(epc, "manual", Date.now());
  return res.json({ ok: true, removed });
});

app.get("/api/pos/cart", requireSession, (req, res) =>
  res.json(req.retailSession.state.cartStore.snapshot())
);

app.post("/api/pos/cart/add", requireSession, requireSelectedStore, async (req, res) => {
  const epc = normalizeEpc(req.body?.epc);
  if (!epc) {
    return res.status(400).json({ ok: false, error: "epc is required" });
  }

  const liveItem = req.retailSession.state.zoneTracker.list().find((row) => row.epc === epc);
  const catalogItem = await lookupCatalogItem(req.retailSession, epc);
  const item = liveItem || (catalogItem ? toZoneItem(catalogItem) : null);
  if (!item) {
    return res.status(404).json({ ok: false, error: `Unknown EPC: ${epc}` });
  }

  return res.json(req.retailSession.state.cartStore.add(item));
});

app.post("/api/pos/cart/remove", requireSession, (req, res) => {
  const epc = normalizeEpc(req.body?.epc);
  if (!epc) {
    return res.status(400).json({ ok: false, error: "epc is required" });
  }
  return res.json(req.retailSession.state.cartStore.remove(epc));
});

app.post("/api/pos/cart/clear", requireSession, (_req, res) =>
  res.json(_req.retailSession.state.cartStore.clear())
);

app.get("/api/inventory/summary", requireSession, requireSelectedStore, async (req, res) => {
  try {
    const items = await fetchCatalog(req.retailSession, 1000);
    const grouped = new Map();
    const inZoneBySku = req.retailSession.state.zoneTracker.countBySku();
    const stocktakeBySku = req.retailSession.state.stocktakeStore.countBySku();

    for (const item of items) {
      const key = item.sku || item.name || item.epc;
      if (!grouped.has(key)) {
        grouped.set(key, {
          sku: item.sku || item.epc,
          name: item.name || item.sku || item.epc,
          category: item.category || "",
          currency: "LKR",
          unitPrice: Number(item.price || 0),
          stock: 0,
          inZone: 0,
          stocktakeScanned: 0,
          available: 0,
        });
      }

      const row = grouped.get(key);
      row.stock += Number(item.stock || 1);
      row.inZone = Number(inZoneBySku[row.sku] || 0);
      row.stocktakeScanned = Number(stocktakeBySku[row.sku] || 0);
      row.available = Math.max(row.stock - row.inZone, 0);
    }

    return res.json({
      items: [...grouped.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
      count: grouped.size,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/inventory/stocktake/recent", requireSession, requireSelectedStore, (req, res) => {
  return res.json({
    items: req.retailSession.state.stocktakeStore.recent(80),
    summary: req.retailSession.state.stocktakeStore.summary(),
  });
});

app.post("/api/inventory/stocktake/scan", requireSession, requireSelectedStore, async (req, res) => {
  try {
    if (!req.retailSession.products.includes("stock_audit")) {
      return res.status(403).json({ ok: false, error: "Stock audit not enabled for this account" });
    }

    const epc = normalizeEpc(req.body?.epc);
    if (!epc) {
      return res.status(400).json({ ok: false, error: "epc is required" });
    }

    await ensureStocktakeSession(req.retailSession);
    await authorizedFetch(req.retailSession, "stock_audit", "/api/v1/inventory/scan", {
      method: "POST",
      body: JSON.stringify({
        store_id: req.retailSession.selectedStoreId,
        device_id: RETAIL_DEVICE_ID,
        epc,
      }),
    });

    const item = await lookupCatalogItem(req.retailSession, epc);
    if (item) {
      req.retailSession.state.stocktakeStore.touch(toZoneItem(item), {
        device_id: RETAIL_DEVICE_ID,
        store_id: req.retailSession.selectedStoreId,
      });
    }

    rememberRecentEpc(req.retailSession.state, epc, {
      source: "Inventory intake",
      assigned: Boolean(item),
      item,
    });

    broadcastToState(req.retailSession.state, {
      type: "inventory.stocktake_scan",
      epc,
      at: Date.now(),
    });

    return res.json({ ok: true, epc, item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/inventory/stocktake/clear", requireSession, (_req, res) => {
  const summary = _req.retailSession.state.stocktakeStore.clear();
  return res.json({ ok: true, summary, persisted: false });
});

app.get("/api/laundry/items", requireSession, requireSelectedStore, async (req, res) => {
  try {
    if (!req.retailSession.products.includes("laundry")) {
      return res.json({
        items: [],
        summary: { uniqueEpcs: 0, totalScanEvents: 0, byStatus: {} },
      });
    }

    const [itemsBody, summaryBody] = await Promise.all([
      authorizedFetch(
        req.retailSession,
        "laundry",
        `/api/v1/laundry/items?store_id=${encodeURIComponent(req.retailSession.selectedStoreId)}&limit=80`
      ),
      authorizedFetch(
        req.retailSession,
        "laundry",
        `/api/v1/laundry/summary?store_id=${encodeURIComponent(req.retailSession.selectedStoreId)}`
      ),
    ]);

    const items = Array.isArray(itemsBody?.items)
      ? itemsBody.items.map((item) => ({
          epc: item.epc,
          sku: item.item_code || "",
          name: item.item_name || "",
          category: item.item_category || "",
          bin: item.current_location || "",
          status: item.status || "",
          scans: 1,
          last_seen_iso: item.last_event_at || item.created_at || new Date().toISOString(),
        }))
      : [];

    return res.json({
      items,
      summary: summaryBody?.summary || mapLaundrySummary(items),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/laundry/scan", requireSession, requireSelectedStore, async (req, res) => {
  try {
    if (!req.retailSession.products.includes("laundry")) {
      return res.status(403).json({ ok: false, error: "Laundry not enabled for this account" });
    }

    const epc = normalizeEpc(req.body?.epc);
    if (!epc) {
      return res.status(400).json({ ok: false, error: "epc is required" });
    }

    const action = mapLaundryStatusToAction(req.body?.status);
    const body = await authorizedFetch(req.retailSession, "laundry", "/api/v1/laundry/actions", {
      method: "POST",
      body: JSON.stringify({
        store_id: req.retailSession.selectedStoreId,
        action,
        epcs: [epc],
        location_label: "Retail Console",
      }),
    });

    rememberRecentEpc(req.retailSession.state, epc, {
      source: "Laundry",
      assigned: true,
      item: null,
    });

    broadcastToState(req.retailSession.state, {
      type: "laundry.scan",
      epc,
      at: Date.now(),
    });

    return res.json({ ok: true, items: body?.items || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/laundry/clear", requireSession, (_req, res) =>
  res.json({ ok: true, cleared: false, persisted: true })
);

app.get("/api/assignments", requireSession, requireSelectedStore, async (req, res) => {
  try {
    const items = await fetchCatalog(req.retailSession, 1000);
    return res.json({
      items: items.sort((a, b) => String(b.epc).localeCompare(String(a.epc))),
      count: items.length,
      include_seed_demo_items: false,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/assignments/recent-epcs", requireSession, requireSelectedStore, async (req, res) => {
  try {
    const assignments = await fetchCatalog(req.retailSession, 1000);
    const assignmentByEpc = new Map(assignments.map((item) => [item.epc, item]));
    const items = [];
    const state = req.retailSession.state;

    for (const liveItem of state.zoneTracker.list()) {
      items.push({
        epc: liveItem.epc,
        source: "Bin live zone",
        seenAt: liveItem.lastSeenAt,
        seenAtIso: new Date(liveItem.lastSeenAt).toISOString(),
        assigned: assignmentByEpc.has(liveItem.epc),
        item: assignmentByEpc.get(liveItem.epc) || null,
      });
    }

    for (const row of state.recentLiveEpcs.values()) {
      if (items.some((item) => item.epc === row.epc)) continue;
      items.push({
        epc: row.epc,
        source: row.source || "Live reader",
        seenAt: row.seenAt,
        seenAtIso: new Date(row.seenAt).toISOString(),
        assigned: assignmentByEpc.has(row.epc),
        item: assignmentByEpc.get(row.epc) || row.item || null,
      });
    }

    items.sort((a, b) => Number(b.seenAt || 0) - Number(a.seenAt || 0));
    return res.json({ items: items.slice(0, 30), count: items.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/assignments", requireSession, requireSelectedStore, async (req, res) => {
  try {
    const payload = {
      store_id: req.retailSession.selectedStoreId,
      epc: normalizeEpc(req.body?.epc),
      sku: String(req.body?.sku || "").trim() || null,
      product_name: String(req.body?.name || req.body?.product_name || "").trim(),
      brand: String(req.body?.brand || "").trim() || null,
      category: String(req.body?.category || "").trim() || "Retail",
      size: String(req.body?.size || "").trim() || null,
      color: String(req.body?.color || "").trim() || null,
      bin: String(req.body?.bin || "").trim() || null,
      price: Number(req.body?.price || 0),
      stock: Number(req.body?.stock || 1),
      laundryStatus: String(req.body?.laundryStatus || "").trim() || null,
      notes: String(req.body?.notes || "").trim() || null,
      barcode: String(req.body?.barcode || "").trim() || null,
    };

    const body = await authorizedFetch(req.retailSession, "retail", "/api/v1/catalog/upsert-item", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const item = toAssignmentItem(body?.item || {});
    rememberRecentEpc(req.retailSession.state, item.epc, {
      source: "Assignment saved",
      assigned: true,
      item,
    });

    broadcastToState(req.retailSession.state, {
      type: "assignment.saved",
      epc: item.epc,
      at: Date.now(),
    });

    return res.json({ ok: true, item });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const frontendRoot = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendRoot));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(frontendRoot, "index.html"));
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[xandora-retail-console] real mode at http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT} -> ${MAIN_API_URL}`
  );
});
