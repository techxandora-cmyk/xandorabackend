const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const buildAnomalyRoutes = require("../api/routes/anomalies");

function createApp(pool) {
  const app = express();
  app.use(express.json());
  app.locals.broadcastEvent = jest.fn();
  app.use("/api/v1/anomalies", buildAnomalyRoutes(pool));
  return app;
}

function buildAuthHeader(payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return `Bearer ${token}`;
}

function adminAuthHeader() {
  return buildAuthHeader({
    user_id: 1,
    email: "admin@test.local",
    roles: ["ADMIN"],
  });
}

function staffAuthHeader() {
  return buildAuthHeader({
    user_id: 2,
    email: "staff@test.local",
    roles: ["STORE_STAFF"],
  });
}

describe("anomalies routes", () => {
  let errorSpy;

  beforeEach(() => {
    process.env.JWT_SECRET = "test_secret";
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("rejects write for non-admin users", async () => {
    const pool = { query: jest.fn() };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", staffAuthHeader())
      .send({
        rule_code: "MANUAL",
        tag: "EPC-001",
        details: { note: "test" },
        status: "open",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Admin required/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("validates missing tag before DB calls", async () => {
    const pool = { query: jest.fn() };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", adminAuthHeader())
      .send({
        rule_code: "MANUAL",
        details: { note: "test" },
        status: "open",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("tag is required");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("validates details payload type", async () => {
    const pool = { query: jest.fn() };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", adminAuthHeader())
      .send({
        rule_code: "MANUAL",
        tag: "EPC-001",
        details: "not-an-object",
        status: "open",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("details must be a JSON object");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid rule_code", async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", adminAuthHeader())
      .send({
        rule_code: "NOPE_RULE",
        tag: "EPC-001",
        details: { note: "test" },
        status: "open",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("Invalid rule_code: NOPE_RULE");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("creates anomaly for valid payload", async () => {
    const insertedRow = {
      id: "101",
      rule_code: "MANUAL",
      tag: "EPC-001",
      device_id: "DEV-01",
      antenna_role: null,
      details: { note: "test" },
      status: "open",
    };

    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ code: "MANUAL", enabled: true }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [insertedRow],
        }),
    };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", adminAuthHeader())
      .send({
        rule_code: "MANUAL",
        tag: "EPC-001",
        device_id: "DEV-01",
        details: { note: "test" },
        status: "open",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.anomaly.id).toBe("101");
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("maps DB not-null constraint to 400", async () => {
    const dbError = new Error("null value violates not-null constraint");
    dbError.code = "23502";
    dbError.column = "details";

    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ code: "MANUAL", enabled: true }],
        })
        .mockRejectedValueOnce(dbError),
    };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/anomalies")
      .set("Authorization", adminAuthHeader())
      .send({
        rule_code: "MANUAL",
        tag: "EPC-001",
        details: { note: "test" },
        status: "open",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("details is required");
  });
});
