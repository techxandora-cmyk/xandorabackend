const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../api/routes/lib/catalogTable", () => ({
  ensureCatalogTable: jest.fn().mockResolvedValue(true),
}));

jest.mock("../api/routes/lib/retailValidation", () => ({
  validationLabel: jest.fn((status) => status),
}));

const buildPosRoutes = require("../api/routes/pos");

function buildAuthHeader(payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return `Bearer ${token}`;
}

function createApp(pool) {
  const app = express();
  app.use(express.json());
  app.locals.broadcastEvent = jest.fn();
  app.use("/api/v1/pos", buildPosRoutes(pool));
  return app;
}

function createPool() {
  const client = {
    query: jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes("SELECT id") && text.includes("WHERE ext_id")) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes("INSERT INTO pos_transactions")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 101,
              ext_id: "retail-console-STORE_001-1",
              store_id: "STORE_001",
              total_amount: 100,
              total_items: 1,
              metadata: { txn_type: "SALE" },
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: jest.fn(),
  };

  return {
    client,
    connect: jest.fn(async () => client),
  };
}

describe("POS route retail writer authorization", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.POS_API_KEY = "test-pos-key";
  });

  it("allows an authenticated retail user to upload a sale for their store", async () => {
    const pool = createPool();
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/pos/upload")
      .set(
        "Authorization",
        buildAuthHeader({
          user_id: 7,
          email: "cashier@example.com",
          roles: ["CASHIER"],
          store_ids: ["STORE_001"],
        })
      )
      .send({
        ext_id: "retail-console-STORE_001-1",
        store_id: "STORE_001",
        total_amount: 100,
        items: [{ epc: "EPC-1", price: 100 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(pool.connect).toHaveBeenCalled();
  });

  it("blocks an authenticated retail user from uploading to another store", async () => {
    const pool = createPool();
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/pos/upload")
      .set(
        "Authorization",
        buildAuthHeader({
          user_id: 7,
          email: "cashier@example.com",
          roles: ["CASHIER"],
          store_ids: ["STORE_002"],
        })
      )
      .send({
        ext_id: "retail-console-STORE_001-1",
        store_id: "STORE_001",
        total_amount: 100,
        items: [{ epc: "EPC-1", price: 100 }],
      });

    expect(res.status).toBe(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
