require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const logger = require("../src/services/logger");
const cache = require("../src/services/cache");
const rabbit = require("../src/services/rabbit");
const { buildRuntimeHealth } = require("../src/services/runtimeHealth");
const { createRequestContext } = require("../src/middleware/requestContext");
const { applySecurityHeaders } = require("../src/middleware/securityHeaders");
const {
  createRateLimiter,
  matchWriteMethods,
} = require("../src/middleware/rateLimit");

const buildScanRoutes = require("../src/api/routes/scans");
const buildAnomalyRoutes = require("../src/api/routes/anomalies");
const buildMetricsRoutes = require("../src/api/routes/metrics");
const buildDevicesRoutes = require("../src/api/routes/devices");
const buildAdminRoutes = require("../src/api/routes/admin");
const buildInventoryRoutes = require("../src/api/routes/inventory");
const buildPosRoutes = require("../src/api/routes/pos");
const buildAuthRoutes = require("../src/api/routes/auth");
const buildRolePermissionsRoutes = require("../src/api/routes/rolePermissions");
const buildAlertsRoutes = require("../src/api/routes/alerts");
const buildBillingRoutes = require("./api/routes/billing");
const buildCatalogRoutes = require("../src/api/routes/catalog");
const buildInventoryIntelligenceRoutes = require("../src/api/routes/inventoryIntelligence");
const buildStockRoutes = require("../src/api/routes/stock");
const buildLaundryRoutes = require("../src/api/routes/laundry");
const startAlertScheduler = require("../src/jobs/alertScheduler");
const startDataRetentionJob = require("../src/jobs/dataRetention");

const app = express();
const startedAt = new Date().toISOString();

app.disable("x-powered-by");

if (process.env.TRUST_PROXY != null && process.env.TRUST_PROXY !== "") {
  const rawTrustProxy = String(process.env.TRUST_PROXY).trim().toLowerCase();
  const trustProxy =
    rawTrustProxy === "true"
      ? true
      : rawTrustProxy === "false"
      ? false
      : rawTrustProxy === "1"
      ? 1
      : rawTrustProxy;
  app.set("trust proxy", trustProxy);
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/rfid";
const PG_POOL_MAX = Math.min(
  Math.max(Number(process.env.PG_POOL_MAX || 30), 5),
  100
);
const PG_IDLE_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.PG_IDLE_TIMEOUT_MS || 10000), 1000),
  60000
);
const PG_CONN_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.PG_CONN_TIMEOUT_MS || 3000), 500),
  20000
);
const BODY_LIMIT = String(process.env.API_BODY_LIMIT || "5mb").trim() || "5mb";

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: PG_POOL_MAX,
  idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_CONN_TIMEOUT_MS,
});

pool.on("error", (err) => {
  logger.error(
    { err: err && err.message ? err.message : err },
    "Unexpected PostgreSQL pool error"
  );
});

const CONFIGURED_FRONTEND_ORIGIN = String(
  process.env.FRONTEND_ORIGIN || ""
).trim();
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEV_LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function resolveCorsOrigin(origin) {
  const requestOrigin = String(origin || "").trim();

  if (!requestOrigin) {
    return CONFIGURED_FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN;
  }

  if (CONFIGURED_FRONTEND_ORIGIN) {
    return requestOrigin === CONFIGURED_FRONTEND_ORIGIN ? requestOrigin : null;
  }

  if (DEV_LOCALHOST_ORIGIN.test(requestOrigin)) {
    return requestOrigin;
  }

  return requestOrigin === DEFAULT_FRONTEND_ORIGIN ? requestOrigin : null;
}

function errorPayload(req, message, extra = {}) {
  return {
    ok: false,
    error: message,
    request_id: req?.id || null,
    ...extra,
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  key: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    return `${req.ip || "unknown"}:${email || "anonymous"}`;
  },
  message: "Too many login attempts. Please wait before trying again.",
});

const adminWriteRateLimiter = createRateLimiter({
  windowMs: Number(process.env.ADMIN_WRITE_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.ADMIN_WRITE_RATE_LIMIT_MAX || 120),
  key: (req) => {
    const userId = req.user?.user_id || req.headers.authorization || req.ip || "anonymous";
    return `admin:${userId}`;
  },
  skip: (req) => !matchWriteMethods(req),
  message: "Admin write limit reached. Please slow down and retry shortly.",
});

app.use(createRequestContext);
app.use(applySecurityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigin = resolveCorsOrigin(origin);
      if (allowedOrigin) {
        return callback(null, allowedOrigin);
      }
      return callback(new Error(`CORS blocked for origin: ${String(origin || "")}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Pragma",
      "Cache-Control",
      "X-Request-Id",
    ],
  })
);
app.use(express.json({ limit: BODY_LIMIT }));

let eventsRouter;
let broadcastEvent = () => {};

try {
  const eventsModule = require("../src/api/routes/events");

  eventsRouter =
    typeof eventsModule === "function"
      ? eventsModule(pool)
      : eventsModule?.default?.(pool);

  broadcastEvent =
    eventsRouter?.broadcastEvent ||
    eventsModule?.broadcastEvent ||
    broadcastEvent;
} catch (err) {
  logger.warn(
    { err: err && err.message ? err.message : err },
    "Events module not found, using fallback SSE router"
  );

  const router = express.Router();
  const clients = new Set();

  function sseHandler(req, res) {
    const allowedOrigin =
      resolveCorsOrigin(req.headers.origin) ||
      CONFIGURED_FRONTEND_ORIGIN ||
      DEFAULT_FRONTEND_ORIGIN;

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": allowedOrigin,
    });

    res.flushHeaders?.();

    const client = { res };
    clients.add(client);

    req.on("close", () => {
      clients.delete(client);
    });
  }

  router.get("/", sseHandler);
  router.get("/stream", sseHandler);

  broadcastEvent = (event, data) => {
    const payload = JSON.stringify(data || {});
    for (const client of clients) {
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${payload}\n\n`);
    }
  };

  eventsRouter = router;
}

app.locals.broadcastEvent = broadcastEvent;
app.locals.logger = logger;
app.locals.pool = pool;

app.use("/api/v1/auth/login", loginRateLimiter);
app.use("/api/v1/admin", adminWriteRateLimiter);

app.use("/api/v1/scans", buildScanRoutes(pool));
app.use("/api/v1/anomalies", buildAnomalyRoutes(pool));
app.use("/api/v1/inventory/intelligence", buildInventoryIntelligenceRoutes(pool));
app.use("/api/v1/metrics", buildMetricsRoutes(pool));
app.use("/api/v1/devices", buildDevicesRoutes(pool));
app.use("/api/v1/admin", buildAdminRoutes(pool));
app.use("/api/v1/inventory", buildInventoryRoutes(pool));
app.use("/api/v1/pos", buildPosRoutes(pool));
app.use("/api/v1/auth", buildAuthRoutes(pool));
app.use("/api/v1/admin/role-permissions", buildRolePermissionsRoutes(pool));
app.use("/api/v1/alerts", buildAlertsRoutes(pool));
app.use("/api/v1/billing", buildBillingRoutes(pool));
app.use("/api/v1/catalog", buildCatalogRoutes(pool));
app.use("/api/v1/stock", buildStockRoutes(pool));
app.use("/api/v1/laundry", buildLaundryRoutes(pool));
app.use("/api/v1/events", eventsRouter);

app.get("/api/health/live", (req, res) => {
  return res.status(200).json({
    ok: true,
    status: "live",
    request_id: req.id,
    started_at: startedAt,
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

async function sendRuntimeHealth(req, res) {
  const snapshot = await buildRuntimeHealth({
    pool,
    cache,
    rabbit,
    startedAt,
  });

  return res.status(snapshot.ok ? 200 : 503).json({
    ...snapshot,
    request_id: req.id,
  });
}

app.get("/api/health/ready", async (req, res, next) => {
  try {
    return await sendRuntimeHealth(req, res);
  } catch (err) {
    return next(err);
  }
});

app.get("/api/health", async (req, res, next) => {
  try {
    return await sendRuntimeHealth(req, res);
  } catch (err) {
    return next(err);
  }
});

if (!process.env.CLOUD_FUNCTION) {
  startAlertScheduler(pool);
  startDataRetentionJob(pool);
}

app.use((req, res) => {
  return res.status(404).json(errorPayload(req, "Not Found"));
});

app.use((err, req, res, _next) => {
  const message = err && err.message ? err.message : "Internal server error";
  const isCorsError = /CORS blocked/i.test(message);
  const statusCode = err?.statusCode || err?.status || (isCorsError ? 403 : 500);

  req.log?.[statusCode >= 500 ? "error" : "warn"](
    {
      err: message,
      stack: statusCode >= 500 ? err?.stack : undefined,
    },
    "Unhandled server error"
  );

  return res.status(statusCode).json(
    errorPayload(req, statusCode >= 500 ? "Internal server error" : message)
  );
});

if (!process.env.CLOUD_FUNCTION) {
  const PORT = Number(process.env.PORT || 3000);
  const server = app.listen(PORT, () => {
    logger.info(
      {
        url: `http://localhost:${PORT}`,
        cors_origin: CONFIGURED_FRONTEND_ORIGIN || "localhost dev origins",
        pg_pool_max: PG_POOL_MAX,
        pg_idle_timeout_ms: PG_IDLE_TIMEOUT_MS,
        pg_connection_timeout_ms: PG_CONN_TIMEOUT_MS,
        body_limit: BODY_LIMIT,
      },
      "API startup complete"
    );
  });

  server.on("error", (err) => {
    logger.error(
      { err: err && err.message ? err.message : err },
      "Failed to bind API port"
    );
    process.exit(1);
  });
}

module.exports = {
  app,
  pool,
};
