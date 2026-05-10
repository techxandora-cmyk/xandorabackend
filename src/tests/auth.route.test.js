const express = require("express");
const request = require("supertest");

jest.mock("../api/routes/lib/productAccess", () => ({
  normalizeProductKey: jest.fn((value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return ["portal", "retail", "laundry", "stock_audit"].includes(normalized)
      ? normalized
      : "";
  }),
  ensureProductAccessTables: jest.fn().mockResolvedValue(true),
  getEnabledCompanyProducts: jest.fn().mockResolvedValue([]),
  getEnabledUserProducts: jest.fn().mockResolvedValue(["retail"]),
}));

const buildAuthRoutes = require("../api/routes/auth");
const {
  ensureProductAccessTables,
  getEnabledUserProducts,
} = require("../api/routes/lib/productAccess");

function createApp(pool) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", buildAuthRoutes(pool));
  return app;
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

describe("auth routes", () => {
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    process.env.JWT_SECRET = "test_secret";
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("returns 401 instead of 500 when a user record has no password hash", async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        const normalizedSql = normalizeSql(sql);

        if (
          normalizedSql.includes(
            "SELECT id, email, COALESCE(password_hash, '') AS password_hash, is_active, company_name FROM users"
          )
        ) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 41,
                email: "broken@example.com",
                password_hash: "",
                is_active: true,
                company_name: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected SQL in auth test: ${normalizedSql}`);
      }),
    };

    const app = createApp(pool);

    const res = await request(app).post("/api/v1/auth/login").send({
      email: "broken@example.com",
      password: "does-not-matter",
      product_key: "retail",
    });

    expect(res.statusCode).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(ensureProductAccessTables).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[auth/login] user has no password_hash; rejecting login",
      expect.objectContaining({
        user_id: 41,
        email: "broken@example.com",
      })
    );
  });

  it("accepts a legacy plaintext password and upgrades it to bcrypt", async () => {
    let upgradedHash = null;

    const pool = {
      query: jest.fn(async (sql, params) => {
        const normalizedSql = normalizeSql(sql);

        if (
          normalizedSql.includes(
            "SELECT id, email, COALESCE(password_hash, '') AS password_hash, is_active, company_name FROM users"
          )
        ) {
          expect(params).toEqual(["legacy@example.com"]);
          return {
            rowCount: 1,
            rows: [
              {
                id: 7,
                email: "legacy@example.com",
                password_hash: "OpenSesame!123",
                is_active: true,
                company_name: null,
              },
            ],
          };
        }

        if (normalizedSql.includes("UPDATE users SET password_hash = $2")) {
          expect(params[0]).toBe(7);
          upgradedHash = params[1];
          return { rowCount: 1, rows: [] };
        }

        if (normalizedSql.includes("SELECT store_id, role FROM user_store_roles")) {
          expect(params).toEqual([7]);
          return {
            rowCount: 1,
            rows: [{ store_id: "_GLOBAL_", role: "MASTER_ADMIN" }],
          };
        }

        if (normalizedSql === "SELECT to_regclass($1) AS regclass_name") {
          expect(params).toEqual(["public.customer_payment_alerts"]);
          return {
            rowCount: 1,
            rows: [{ regclass_name: null }],
          };
        }

        if (normalizedSql.includes("SELECT role, permissions FROM role_permissions")) {
          return { rowCount: 0, rows: [] };
        }

        throw new Error(`Unexpected SQL in auth test: ${normalizedSql}`);
      }),
    };

    const app = createApp(pool);

    const res = await request(app).post("/api/v1/auth/login").send({
      email: "legacy@example.com",
      password: "OpenSesame!123",
      product_key: "retail",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(ensureProductAccessTables).toHaveBeenCalledWith(pool);
    expect(getEnabledUserProducts).toHaveBeenCalledWith(pool, 7);
    expect(upgradedHash).toMatch(/^\$2[aby]\$/);
    expect(upgradedHash).not.toBe("OpenSesame!123");
  });
});
