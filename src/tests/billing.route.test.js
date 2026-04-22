const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../api/routes/lib/catalogTable", () => ({
  ensureCatalogTable: jest.fn().mockResolvedValue(true),
}));

jest.mock("../api/routes/lib/operationalAlerts", () => ({
  upsertOperationalAlert: jest.fn().mockResolvedValue({
    action: "inserted",
    alert: { id: 501 },
  }),
}));

jest.mock("../api/routes/lib/retailValidation", () => ({
  getNetSoldCount: jest.fn(),
  validateRetailScan: jest.fn().mockResolvedValue({
    validation_status: "UNKNOWN_EPC",
    validation_label: "Unknown EPC",
    validation_message: "No catalog item is mapped to this EPC in the selected store.",
    already_billed: false,
    catalog_item: null,
  }),
}));

const buildBillingRoutes = require("../../backend/api/routes/billing");
const { ensureCatalogTable } = require("../api/routes/lib/catalogTable");
const { upsertOperationalAlert } = require("../api/routes/lib/operationalAlerts");
const { validateRetailScan } = require("../api/routes/lib/retailValidation");

function createApp(pool) {
  const app = express();
  app.use(express.json());
  app.locals.broadcastEvent = jest.fn();
  app.use("/api/v1/billing", buildBillingRoutes(pool));
  return app;
}

function buildAuthHeader(payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return `Bearer ${token}`;
}

describe("billing routes", () => {
  let errorSpy;

  beforeEach(() => {
    process.env.JWT_SECRET = "test_secret";
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("mirrors successful billing scans into scan_items for the web live feed", async () => {
    const activeSession = {
      id: "901",
      session_id: "BILL-901",
      store_id: "STORE_001",
      status: "ACTIVE",
      started_at: "2026-04-22T10:00:00.000Z",
      ended_at: null,
      expected_items_count: 3,
      scanned_items_count: 0,
      metrics_summary: {},
    };

    const persistedSession = {
      ...activeSession,
      scanned_items_count: 1,
      updated_at: "2026-04-22T10:00:05.000Z",
      metrics_summary: {},
    };

    const billingScanRow = {
      session_id: "901",
      epc: "EPC-001",
      device_id: "HANDHELD_RETAIL_STORE_001",
      read_count: 1,
      first_seen: "2026-04-22T10:00:05.000Z",
      last_seen: "2026-04-22T10:00:05.000Z",
      validation_status: "UNKNOWN_EPC",
      validation_message: "No catalog item is mapped to this EPC in the selected store.",
      sku: null,
      product_name: null,
      price_lkr: null,
    };

    const mirroredScanRow = {
      id: "7001",
      tag: "EPC-001",
      device_id: "HANDHELD_RETAIL_STORE_001",
      store_id: "STORE_001",
      ts: "2026-04-22T10:00:05.000Z",
      first_seen: "2026-04-22T10:00:05.000Z",
      last_seen: "2026-04-22T10:00:05.000Z",
      read_count: 1,
      processing_status: "CONFIRMED",
    };

    const client = {
      query: jest.fn(async (sql, params) => {
        const normalizedSql = String(sql).replace(/\s+/g, " ").trim();

        if (normalizedSql === "BEGIN" || normalizedSql === "COMMIT" || normalizedSql === "ROLLBACK") {
          return { rowCount: 0, rows: [] };
        }

        if (normalizedSql.includes("SELECT * FROM billing_sessions")) {
          expect(params).toEqual(["STORE_001"]);
          return { rowCount: 1, rows: [activeSession] };
        }

        if (normalizedSql.includes("SELECT read_count FROM billing_session_scans")) {
          expect(params).toEqual(["901", "EPC-001"]);
          return { rowCount: 0, rows: [] };
        }

        if (normalizedSql.includes("INSERT INTO billing_session_scans")) {
          expect(params[0]).toBe("901");
          expect(params[1]).toBe("EPC-001");
          expect(params[2]).toBe("HANDHELD_RETAIL_STORE_001");
          return { rowCount: 1, rows: [] };
        }

        if (normalizedSql.includes("SELECT COUNT(*)::int AS unique_epcs")) {
          return {
            rowCount: 1,
            rows: [
              {
                unique_epcs: 1,
                total_reads: 1,
                matched_count: 0,
                unknown_count: 1,
                already_billed_count: 0,
                duplicate_count: 0,
                validation_failed_count: 0,
                first_scan_at: "2026-04-22T10:00:05.000Z",
                last_scan_at: "2026-04-22T10:00:05.000Z",
              },
            ],
          };
        }

        if (normalizedSql.includes("UPDATE billing_sessions")) {
          expect(params[0]).toBe("901");
          return { rowCount: 1, rows: [persistedSession] };
        }

        if (
          normalizedSql.includes("SELECT * FROM billing_session_scans") &&
          normalizedSql.includes("WHERE session_id = $1")
        ) {
          expect(params).toEqual(["901", "EPC-001"]);
          return { rowCount: 1, rows: [billingScanRow] };
        }

        if (normalizedSql.includes("INSERT INTO scan_items")) {
          expect(params[0]).toBe("HANDHELD_RETAIL_STORE_001");
          expect(params[1]).toBe("EPC-001");
          expect(params[3]).toBe("STORE_001");

          const rawPayload = JSON.parse(params[4]);
          expect(rawPayload).toMatchObject({
            tag: "EPC-001",
            store_id: "STORE_001",
            device_id: "HANDHELD_RETAIL_STORE_001",
            source: "billing_session",
            session_id: "BILL-901",
            validation_status: "UNKNOWN_EPC",
          });

          const metricsPayload = JSON.parse(params[8]);
          expect(metricsPayload).toMatchObject({
            source: "billing_session",
            session_id: "BILL-901",
            validation_status: "UNKNOWN_EPC",
            read_count: 1,
          });

          return { rowCount: 1, rows: [mirroredScanRow] };
        }

        throw new Error(`Unexpected SQL in test: ${normalizedSql}`);
      }),
      release: jest.fn(),
    };

    const pool = {
      connect: jest.fn().mockResolvedValue(client),
    };

    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/billing/scan")
      .set(
        "Authorization",
        buildAuthHeader({
          user_id: 11,
          email: "cashier@test.local",
          roles: ["STORE_STAFF"],
          store_ids: ["STORE_001"],
        })
      )
      .send({
        store_id: "STORE_001",
        epc: "epc-001",
        device_id: "HANDHELD_RETAIL_STORE_001",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.validation.validation_status).toBe("UNKNOWN_EPC");
    expect(res.body.scan.epc).toBe("EPC-001");

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(ensureCatalogTable).toHaveBeenCalledWith(client);
    expect(validateRetailScan).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        store_id: "STORE_001",
        epc: "EPC-001",
        duplicate_read_count: 0,
      })
    );
    expect(upsertOperationalAlert).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        type: "UNKNOWN_EPC_DETECTED",
        store_id: "STORE_001",
        entity_type: "BILLING_SCAN",
      })
    );
    expect(app.locals.broadcastEvent).toHaveBeenCalledWith(
      "scan",
      expect.objectContaining({
        tag: "EPC-001",
        store_id: "STORE_001",
        device_id: "HANDHELD_RETAIL_STORE_001",
        source: "billing/scan",
      })
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
