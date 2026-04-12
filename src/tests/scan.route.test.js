const express = require("express");
const request = require("supertest");

const buildEventsRoutes = require("../api/routes/events");
const { clearRecentEvents } = require("../api/routes/events");

function createApp(pool) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/events", buildEventsRoutes(pool));
  return app;
}

describe("events routes", () => {
  beforeEach(() => {
    process.env.SCAN_API_KEY = "test_scan_key";
    clearRecentEvents();
  });

  it("rejects ingest without scan key", async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    const app = createApp(pool);

    const res = await request(app)
      .post("/api/v1/events/ingest")
      .send({ event: "scan_batch", data: { epc: "EPC-001" } });

    expect(res.statusCode).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("accepts ingest with valid key and returns in recent feed", async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    const app = createApp(pool);

    const ingest = await request(app)
      .post("/api/v1/events/ingest")
      .set("x-scan-key", "test_scan_key")
      .send({
        event: "scan_batch",
        data: {
          epc: "EPC-001",
          store_id: "STORE_001",
        },
      });

    expect(ingest.statusCode).toBe(200);
    expect(ingest.body.ok).toBe(true);
    expect(pool.query).toHaveBeenCalled();

    const recent = await request(app).get("/api/v1/events/recent?limit=1");
    expect(recent.statusCode).toBe(200);
    expect(recent.body.ok).toBe(true);
    expect(recent.body.count).toBe(1);
    expect(recent.body.events[0].event).toBe("scan_batch");
  });
});
