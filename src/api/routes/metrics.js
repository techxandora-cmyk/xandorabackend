const express = require("express");
const {
  authenticateJwt,
  attachTenantScope,
  resolveStoreScope,
} = require("../../middleware/tenantScope");

module.exports = function buildMetricsRoutes(pool) {
  const router = express.Router();

  function dayKeyFromValue(v) {
    if (!v) return "";
    if (typeof v === "string") return v.slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function lastNDaysSeries(rows, valueKey, days) {
    const valuesByDay = new Map();

    for (const row of rows || []) {
      const key = dayKeyFromValue(row.day);
      valuesByDay.set(key, Number(row[valueKey] || 0));
    }

    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      out.push(Number(valuesByDay.get(key) || 0));
    }
    return out;
  }

  function buildStoreFilter(storeIds, columnName = "store_id") {
    if (storeIds === null) {
      return {
        clause: "",
        params: [],
      };
    }

    if (!Array.isArray(storeIds) || !storeIds.length) {
      return {
        clause: " AND 1=0",
        params: [],
      };
    }

    return {
      clause: ` AND ${columnName} = ANY($1::text[])`,
      params: [storeIds],
    };
  }

  router.use(authenticateJwt);
  router.use(attachTenantScope(pool));

  /* =========================
     SUMMARY
  ========================= */
  router.get("/summary", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id).trim() : "";
      const period = req.query.period || "24h";

      const scope = resolveStoreScope(req, store_id);
      if (!scope.ok) {
        return res.status(403).json({
          ok: false,
          error: scope.error,
        });
      }

      const { clause: storeFilterSql, params: storeParams } = buildStoreFilter(
        scope.store_ids
      );

      let timeFilter = "";
      if (period === "today") {
        timeFilter = `AND created_at >= date_trunc('day', NOW())`;
      } else if (period === "24h") {
        timeFilter = `AND created_at >= NOW() - INTERVAL '24 hours'`;
      }

      const posResult = await pool.query(
        `
        SELECT
          COALESCE(SUM(total_amount),0) AS total_sales_amount,
          COALESCE(SUM(total_items),0)  AS total_items_sold
        FROM pos_transactions
        WHERE 1=1
        ${storeFilterSql}
        ${timeFilter}
        `,
        storeParams
      );

      const scansTodayResult = await pool.query(
        `
        SELECT COUNT(*)::int AS scanned_today
        FROM scan_items
        WHERE ts >= date_trunc('day', NOW())
        ${storeFilterSql}
        `,
        storeParams
      );

      const scans24hResult = await pool.query(
        `
        SELECT COUNT(*)::int AS scanned_last_24h
        FROM scan_items
        WHERE ts >= NOW() - INTERVAL '24 hours'
        ${storeFilterSql}
        `,
        storeParams
      );

      const summary = {
        total_sales_amount: Number(posResult.rows?.[0]?.total_sales_amount) || 0,
        total_items_sold: Number(posResult.rows?.[0]?.total_items_sold) || 0,
        items_scanned_today: Number(scansTodayResult.rows?.[0]?.scanned_today) || 0,
        items_scanned_24h: Number(scans24hResult.rows?.[0]?.scanned_last_24h) || 0,
      };

      return res.json({ ok: true, summary });
    } catch (err) {
      console.error("[metrics] summary error:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch metrics summary",
      });
    }
  });

  /* =========================
     REVENUE TREND (7 DAYS)
     Fallback to scan activity when no POS sales.
  ========================= */
  router.get("/revenue-trend", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id).trim() : "";

      const scope = resolveStoreScope(req, store_id);
      if (!scope.ok) {
        return res.status(403).json({
          ok: false,
          error: scope.error,
        });
      }

      const { clause: storeFilterSql, params: storeParams } = buildStoreFilter(
        scope.store_ids
      );

      const posResult = await pool.query(
        `
        SELECT
          DATE(created_at) AS day,
          COALESCE(SUM(total_amount),0) AS total
        FROM pos_transactions
        WHERE created_at >= NOW() - INTERVAL '7 days'
        ${storeFilterSql}
        GROUP BY day
        ORDER BY day ASC
        `,
        storeParams
      );

      const salesValues = lastNDaysSeries(posResult.rows, "total", 7);
      const hasSales = salesValues.some((v) => v > 0);

      if (hasSales) {
        return res.json({ ok: true, basis: "sales", values: salesValues });
      }

      const scanResult = await pool.query(
        `
        SELECT
          DATE(ts) AS day,
          COUNT(DISTINCT tag)::int AS total
        FROM scan_items
        WHERE ts >= NOW() - INTERVAL '7 days'
        ${storeFilterSql}
        GROUP BY day
        ORDER BY day ASC
        `,
        storeParams
      );

      const scanValues = lastNDaysSeries(scanResult.rows, "total", 7);
      const hasScans = scanValues.some((v) => v > 0);

      return res.json({
        ok: true,
        basis: hasScans ? "scans" : "none",
        values: scanValues,
      });
    } catch (err) {
      console.error("[metrics] revenue-trend error:", err);
      return res.json({ ok: false, basis: "none", values: [] });
    }
  });

  /* =========================
     STORE COMPARISON
     Fallback to scan activity when no POS sales.
  ========================= */
  router.get("/store-comparison", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id).trim() : "";
      const scope = resolveStoreScope(req, store_id);
      if (!scope.ok) {
        return res.status(403).json({
          ok: false,
          error: scope.error,
        });
      }

      const { clause: storeFilterSql, params: storeParams } = buildStoreFilter(
        scope.store_ids
      );

      const posResult = await pool.query(
        `
        SELECT
          store_id,
          COALESCE(SUM(total_amount),0) AS value
        FROM pos_transactions
        WHERE store_id IS NOT NULL
        ${storeFilterSql}
        GROUP BY store_id
        ORDER BY value DESC
        LIMIT 5
        `,
        storeParams
      );

      const hasSales = posResult.rows.some((r) => Number(r.value || 0) > 0);

      if (hasSales) {
        return res.json({
          ok: true,
          basis: "sales",
          stores: posResult.rows.map((r) => ({
            store_id: r.store_id,
            value: Number(r.value || 0),
          })),
        });
      }

      const scanResult = await pool.query(
        `
        SELECT
          store_id,
          COUNT(DISTINCT tag)::int AS value
        FROM scan_items
        WHERE store_id IS NOT NULL
        ${storeFilterSql}
          AND ts >= NOW() - INTERVAL '24 hours'
        GROUP BY store_id
        ORDER BY value DESC
        LIMIT 5
        `,
        storeParams
      );

      const stores = scanResult.rows.map((r) => ({
        store_id: r.store_id,
        value: Number(r.value || 0),
      }));

      return res.json({
        ok: true,
        basis: stores.length ? "scans" : "none",
        stores,
      });
    } catch (err) {
      console.error("[metrics] store-comparison error:", err);
      return res.json({ ok: false, basis: "none", stores: [] });
    }
  });

  return router;
};
