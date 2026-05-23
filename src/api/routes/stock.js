const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("./lib/catalogTable");
const { writeAuditLog } = require("./lib/audit");

const BARCODE_SQL = `
  COALESCE(
    NULLIF(TRIM(c.metadata->>'barcode'), ''),
    NULLIF(TRIM(c.metadata->>'upc'), ''),
    NULLIF(TRIM(c.metadata->>'ean'), ''),
    NULLIF(TRIM(c.metadata->>'gtin'), ''),
    NULLIF(TRIM(c.metadata->>'bar_code'), '')
  )
`;

const ACTIVE_CATALOG_ROW_SQL = `
  LOWER(COALESCE(c.metadata->>'auto_mapped', 'false')) <> 'true'
  AND LOWER(COALESCE(c.metadata->>'deleted', 'false')) <> 'true'
`;

const GROUP_KEY_SQL = `
  md5(
    concat_ws(
      '||',
      COALESCE(fc.barcode, ''),
      COALESCE(fc.sku, ''),
      COALESCE(fc.product_name, ''),
      COALESCE(fc.brand, ''),
      COALESCE(fc.category, ''),
      COALESCE(fc.size_label, ''),
      COALESCE(fc.color, '')
    )
  )
`;

const CATALOG_GROUP_KEY_SQL = `
  md5(
    concat_ws(
      '||',
      COALESCE(${BARCODE_SQL}, ''),
      COALESCE(c.sku, ''),
      COALESCE(c.product_name, ''),
      COALESCE(c.brand, ''),
      COALESCE(c.category, ''),
      COALESCE(c.size_label, ''),
      COALESCE(c.color, '')
    )
  )
`;

function returnRateSql(soldExpr, returnedExpr) {
  return `
    CASE
      WHEN (${soldExpr}) > 0 THEN (${returnedExpr})::numeric / (${soldExpr})
      ELSE 0
    END
  `;
}

function normalizeEpc(v) {
  return String(v || "").trim().toUpperCase();
}

function normalizeStoreAccessKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/_0*[1-9]\d*$/, "");
}

function actorFromRequest(req) {
  return {
    actor_user_id: Number(req.user?.user_id) || null,
    actor_email: String(req.user?.email || "").trim().toLowerCase() || null,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = function buildStockRoutes(pool) {
  const router = express.Router();

  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function canAccessStore(req, store_id) {
    if (!store_id) return false;
    const normalizedStoreId = normalizeStoreAccessKey(store_id);

    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    ) {
      return true;
    }

    const allowedStores = Array.isArray(req.user?.store_ids)
      ? req.user.store_ids
      : [];
    return allowedStores.some(
      (allowedStoreId) => normalizeStoreAccessKey(allowedStoreId) === normalizedStoreId
    );
  }

  function buildStockStateCtes(whereSql) {
    return `
      WITH filtered_catalog AS (
        SELECT
          c.store_id,
          c.epc,
          c.sku,
          c.product_name,
          c.brand,
          c.category,
          c.size_label,
          c.color,
          c.price_lkr,
          ${BARCODE_SQL} AS barcode
        FROM catalog_items c
        WHERE ${whereSql}
          AND ${ACTIVE_CATALOG_ROW_SQL}
      ),
      epc_states AS (
        SELECT
          pti.epc,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN -1
                ELSE 1
              END
            ),
            0
          )::int AS sold_balance,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS return_events
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
        WHERE UPPER(pt.store_id) = UPPER($1)
        GROUP BY pti.epc
      )
    `;
  }

  function buildStockInsightsCtes(whereSql) {
    return `
      WITH filtered_catalog AS (
        SELECT
          c.store_id,
          c.epc,
          c.sku,
          c.product_name,
          c.brand,
          c.category,
          c.size_label,
          c.color,
          c.price_lkr,
          ${BARCODE_SQL} AS barcode
        FROM catalog_items c
        WHERE ${whereSql}
          AND ${ACTIVE_CATALOG_ROW_SQL}
      ),
      epc_states AS (
        SELECT
          pti.epc,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN -1
                ELSE 1
              END
            ),
            0
          )::int AS sold_balance,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS return_events
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
        WHERE UPPER(pt.store_id) = UPPER($1)
        GROUP BY pti.epc
      ),
      scan_last_seen AS (
        SELECT
          s.tag AS epc,
          MAX(s.ts) AS last_scan_at
        FROM scan_items s
        WHERE UPPER(s.store_id) = UPPER($1)
        GROUP BY s.tag
      ),
      product_rollup AS (
        SELECT
          fc.store_id,
          ${GROUP_KEY_SQL} AS group_key,
          fc.barcode,
          fc.sku,
          fc.product_name,
          fc.brand,
          fc.category,
          fc.size_label,
          fc.color,
          COUNT(*)::int AS total_tags,
          COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS sold_count,
          COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) <= 0 THEN 1 ELSE 0 END), 0)::int AS in_stock_count,
          COALESCE(SUM(CASE WHEN COALESCE(es.return_events, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS returned_count,
          MAX(sl.last_scan_at) AS last_scan_at,
          COALESCE(SUM(CASE WHEN sl.last_scan_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0)::int AS scanned_7d_count
        FROM filtered_catalog fc
        LEFT JOIN epc_states es ON es.epc = fc.epc
        LEFT JOIN scan_last_seen sl ON sl.epc = fc.epc
        GROUP BY
          fc.store_id,
          fc.barcode,
          fc.sku,
          fc.product_name,
          fc.brand,
          fc.category,
          fc.size_label,
          fc.color
      )
    `;
  }

  function buildDirectStockSearchCtes(whereSql) {
    return `
      WITH epc_states AS (
        SELECT
          pti.epc,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN -1
                ELSE 1
              END
            ),
            0
          )::int AS sold_balance,
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                  OR COALESCE(pt.total_amount, 0) < 0
                  OR COALESCE(pt.total_items, 0) < 0
                  THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS return_events
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
        WHERE UPPER(pt.store_id) = UPPER($1)
        GROUP BY pti.epc
      ),
      product_rollup AS (
        SELECT
          c.store_id,
          ${CATALOG_GROUP_KEY_SQL} AS group_key,
          ${BARCODE_SQL} AS barcode,
          c.sku,
          c.product_name,
          c.brand,
          c.category,
          c.size_label,
          c.color,
          COUNT(*)::int AS total_tags,
          COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS sold_count,
          COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) <= 0 THEN 1 ELSE 0 END), 0)::int AS in_stock_count,
          COALESCE(SUM(CASE WHEN COALESCE(es.return_events, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS returned_count
        FROM catalog_items c
        LEFT JOIN epc_states es ON es.epc = c.epc
        WHERE ${whereSql}
          AND ${ACTIVE_CATALOG_ROW_SQL}
        GROUP BY
          c.store_id,
          ${BARCODE_SQL},
          c.sku,
          c.product_name,
          c.brand,
          c.category,
          c.size_label,
          c.color
      )
    `;
  }

  router.use(authenticate);

  router.get("/search", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id) : null;
      const q = String(req.query.q || "").trim();
      const brand = String(req.query.brand || "").trim();
      const barcode = String(req.query.barcode || "").trim();
      const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
      const offset = Math.max(Number(req.query.offset || 0), 0);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const where = ["UPPER(c.store_id) = UPPER($1)"];
      const values = [store_id];
      let i = 2;

      if (q) {
        where.push(`
          (
            c.epc ILIKE $${i}
            OR COALESCE(c.sku, '') ILIKE $${i}
            OR COALESCE(c.product_name, '') ILIKE $${i}
            OR COALESCE(c.brand, '') ILIKE $${i}
            OR COALESCE(c.category, '') ILIKE $${i}
            OR COALESCE(c.size_label, '') ILIKE $${i}
            OR COALESCE(c.metadata->>'barcode', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'upc', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'ean', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'gtin', '') ILIKE $${i}
          )
        `);
        values.push(`%${q}%`);
        i += 1;
      }

      if (brand) {
        where.push(`COALESCE(c.brand, '') ILIKE $${i}`);
        values.push(`%${brand}%`);
        i += 1;
      }

      if (barcode) {
        where.push(`
          (
            COALESCE(c.metadata->>'barcode', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'upc', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'ean', '') ILIKE $${i}
            OR COALESCE(c.metadata->>'gtin', '') ILIKE $${i}
            OR COALESCE(c.sku, '') ILIKE $${i}
            OR c.epc ILIKE $${i}
          )
        `);
        values.push(`%${barcode}%`);
        i += 1;
      }

      const ctes = buildDirectStockSearchCtes(where.join(" AND "));

      const itemsValues = [...values, limit, offset];
      const itemsLimitParam = `$${values.length + 1}`;
      const itemsOffsetParam = `$${values.length + 2}`;

      const [summaryResult, itemsResult] = await Promise.all([
        pool.query(
          `
          ${ctes}
          SELECT
            COUNT(*)::int AS products,
            COALESCE(SUM(total_tags), 0)::int AS total_tags,
            COALESCE(SUM(in_stock_count), 0)::int AS in_stock_tags,
            COALESCE(SUM(sold_count), 0)::int AS sold_tags,
            COALESCE(SUM(returned_count), 0)::int AS returned_tags
          FROM product_rollup
          `,
          values
        ),
        pool.query(
          `
          ${ctes}
          SELECT
            store_id,
            group_key,
            barcode,
            sku,
            product_name,
            brand,
            category,
            size_label,
            color,
            total_tags,
            in_stock_count,
            sold_count,
            returned_count
          FROM product_rollup
          ORDER BY product_name ASC, sku ASC, barcode ASC
          LIMIT ${itemsLimitParam}
          OFFSET ${itemsOffsetParam}
          `,
          itemsValues
        ),
      ]);

      return res.json({
        ok: true,
        store_id,
        filters: {
          q: q || null,
          brand: brand || null,
          barcode: barcode || null,
          limit,
          offset,
        },
        summary: summaryResult.rows[0] || {
          products: 0,
          total_tags: 0,
          in_stock_tags: 0,
          sold_tags: 0,
          returned_tags: 0,
        },
        count: itemsResult.rowCount,
        items: itemsResult.rows,
      });
    } catch (err) {
      console.error("[stock/search]", err);
      return res.status(500).json({ ok: false, error: "Failed to search stock" });
    }
  });

  router.get("/debug-epc", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id).trim() : "";
      const epc = normalizeEpc(req.query.epc);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!epc) {
        return res.status(400).json({ ok: false, error: "epc required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const [catalogResult, stockResult] = await Promise.all([
        pool.query(
          `
          SELECT
            store_id,
            epc,
            sku,
            product_name,
            brand,
            category,
            size_label,
            color,
            price_lkr,
            metadata,
            updated_at,
            ${BARCODE_SQL} AS barcode
          FROM catalog_items c
          WHERE UPPER(c.store_id) = UPPER($1)
            AND c.epc = $2
            AND ${ACTIVE_CATALOG_ROW_SQL}
          ORDER BY updated_at DESC
          LIMIT 10
          `,
          [store_id, epc]
        ),
        pool.query(
          `
          ${buildDirectStockSearchCtes("UPPER(c.store_id) = UPPER($1) AND c.epc = $2")}
          SELECT
            COUNT(*)::int AS products,
            COALESCE(SUM(total_tags), 0)::int AS total_tags,
            COALESCE(SUM(in_stock_count), 0)::int AS in_stock_tags,
            COALESCE(SUM(sold_count), 0)::int AS sold_tags,
            COALESCE(SUM(returned_count), 0)::int AS returned_tags
          FROM product_rollup
          `,
          [store_id, epc]
        ),
      ]);

      return res.json({
        ok: true,
        store_id,
        epc,
        catalog_count: catalogResult.rowCount,
        catalog_items: catalogResult.rows,
        stock_summary: stockResult.rows[0] || null,
      });
    } catch (err) {
      console.error("[stock/debug-epc]", err);
      return res.status(500).json({ ok: false, error: "Failed to debug stock EPC" });
    }
  });

  router.get("/epcs", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id) : null;
      const group_key = req.query.group_key ? String(req.query.group_key) : "";
      const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 2000);
      const offset = Math.max(Number(req.query.offset || 0), 0);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!group_key) {
        return res.status(400).json({ ok: false, error: "group_key required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const ctes = `
        ${buildStockStateCtes("UPPER(c.store_id) = UPPER($1)")}
        ,
        catalog_with_key AS (
          SELECT
            fc.*,
            ${GROUP_KEY_SQL} AS group_key
          FROM filtered_catalog fc
        )
      `;

      const [summaryResult, itemsResult] = await Promise.all([
        pool.query(
          `
          ${ctes}
          SELECT
            COUNT(*)::int AS total_tags,
            COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) <= 0 THEN 1 ELSE 0 END), 0)::int AS in_stock_tags,
            COALESCE(SUM(CASE WHEN COALESCE(es.sold_balance, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS sold_tags,
            COALESCE(SUM(CASE WHEN COALESCE(es.return_events, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS returned_tags
          FROM catalog_with_key cwk
          LEFT JOIN epc_states es ON es.epc = cwk.epc
          WHERE cwk.group_key = $2
          `,
          [store_id, group_key]
        ),
        pool.query(
          `
          ${ctes}
          SELECT
            cwk.store_id,
            cwk.group_key,
            cwk.epc,
            cwk.barcode,
            cwk.sku,
            cwk.product_name,
            cwk.brand,
            cwk.category,
            cwk.size_label,
            cwk.color,
            cwk.price_lkr,
            COALESCE(es.sold_balance, 0)::int AS sold_balance,
            COALESCE(es.return_events, 0)::int AS return_events,
            CASE
              WHEN COALESCE(es.sold_balance, 0) > 0 THEN 'SOLD'
              WHEN COALESCE(es.return_events, 0) > 0 THEN 'RETURNED'
              ELSE 'IN_STOCK'
            END AS stock_state
          FROM catalog_with_key cwk
          LEFT JOIN epc_states es ON es.epc = cwk.epc
          WHERE cwk.group_key = $2
          ORDER BY cwk.epc ASC
          LIMIT $3
          OFFSET $4
          `,
          [store_id, group_key, limit, offset]
        ),
      ]);

      const summary = summaryResult.rows[0] || {
        total_tags: 0,
        in_stock_tags: 0,
        sold_tags: 0,
        returned_tags: 0,
      };

      return res.json({
        ok: true,
        store_id,
        group_key,
        summary,
        count: itemsResult.rowCount,
        items: itemsResult.rows,
      });
    } catch (err) {
      console.error("[stock/epcs]", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch stock EPC details" });
    }
  });

  router.delete("/epcs/:epc", async (req, res) => {
    const client = await pool.connect();
    try {
      const store_id = req.query.store_id ? String(req.query.store_id).trim() : "";
      const epc = normalizeEpc(req.params.epc);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!epc) {
        return res.status(400).json({ ok: false, error: "epc required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(client);
      await client.query("BEGIN");

      const deletedResult = await client.query(
        `
        UPDATE catalog_items
        SET
          metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'deleted', true,
              'deleted_at', NOW()::text,
              'deleted_by', $3
            ),
          updated_at = NOW()
        WHERE UPPER(store_id) = UPPER($1)
          AND epc = $2
          AND LOWER(COALESCE(metadata->>'deleted', 'false')) <> 'true'
        RETURNING
          store_id,
          epc,
          sku,
          product_name,
          brand,
          category,
          size_label,
          color,
          price_lkr,
          COALESCE(
            NULLIF(TRIM(metadata->>'barcode'), ''),
            NULLIF(TRIM(metadata->>'upc'), ''),
            NULLIF(TRIM(metadata->>'ean'), ''),
            NULLIF(TRIM(metadata->>'gtin'), ''),
            NULLIF(TRIM(metadata->>'bar_code'), '')
          ) AS barcode
        `,
        [store_id, epc, String(req.user?.email || req.user?.user_id || "unknown")]
      );

      if (!deletedResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "EPC not found in stock" });
      }

      const deleted = deletedResult.rows[0];
      await writeAuditLog(client, {
        ...actorFromRequest(req),
        action: "CATALOG_ITEM_DELETE",
        entity_type: "CATALOG_ITEM",
        entity_id: `${store_id}:${epc}`,
        store_id,
        metadata: {
          epc,
          sku: deleted.sku || null,
          barcode: deleted.barcode || null,
          product_name: deleted.product_name || null,
          brand: deleted.brand || null,
          category: deleted.category || null,
          size_label: deleted.size_label || null,
          color: deleted.color || null,
          price_lkr: deleted.price_lkr != null ? Number(deleted.price_lkr) : null,
        },
      });

      await client.query("COMMIT");

      let verifyCount = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const verifyResult = await client.query(
          `
          SELECT COUNT(*)::int AS remaining
          FROM catalog_items
          WHERE UPPER(store_id) = UPPER($1)
            AND epc = $2
            AND LOWER(COALESCE(metadata->>'deleted', 'false')) <> 'true'
          `,
          [store_id, epc]
        );
        verifyCount = Number(verifyResult.rows[0]?.remaining || 0);
        if (verifyCount === 0) break;
        if (attempt < 3) {
          await wait(150 * (attempt + 1));
        }
      }

      if (verifyCount > 0) {
        console.error("[stock/delete-epc] verification failed after commit", {
          store_id,
          epc,
          remaining: verifyCount,
        });
        return res.status(500).json({
          ok: false,
          error: "Stock EPC delete was not visible after commit",
          store_id,
          epc,
        });
      }

      const broadcast = req.app.locals.broadcastEvent;
      if (typeof broadcast === "function") {
        const eventPayload = {
          store_id,
          epc,
          sku: deleted.sku || null,
          product_name: deleted.product_name || null,
          brand: deleted.brand || null,
          category: deleted.category || null,
          size_label: deleted.size_label || null,
          color: deleted.color || null,
          price_lkr: deleted.price_lkr != null ? Number(deleted.price_lkr) : null,
          barcode: deleted.barcode || null,
          source: "stock.delete-epc",
          at: new Date().toISOString(),
        };

        broadcast("catalog_item_deleted", eventPayload);
        broadcast("stock_changed", eventPayload);
        broadcast("metrics_changed", {
          store_id,
          source: "stock.delete-epc",
          at: eventPayload.at,
        });
      }

      return res.json({ ok: true, deleted });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[stock/delete-epc]", err);
      return res.status(500).json({ ok: false, error: "Failed to delete stock EPC" });
    } finally {
      client.release();
    }
  });

  router.get("/insights", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id) : null;
      const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);
      const risk_limit = Math.min(
        Math.max(Number(req.query.risk_limit || Math.max(limit * 4, 50)), 10),
        300
      );

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const ctes = buildStockInsightsCtes("UPPER(c.store_id) = UPPER($1)");
      const rateExpr = returnRateSql("sold_count", "returned_count");

      const [topMoversResult, deadStockResult, riskSummaryResult, riskItemsResult, brandRisksResult] =
        await Promise.all([
          pool.query(
            `
            ${ctes}
            SELECT
              group_key,
              barcode,
              sku,
              product_name,
              brand,
              category,
              size_label,
              total_tags,
              in_stock_count,
              sold_count,
              returned_count,
              ROUND((${rateExpr}) * 100, 1) AS return_rate_pct,
              last_scan_at
            FROM product_rollup
            ORDER BY sold_count DESC, in_stock_count ASC, product_name ASC
            LIMIT $2
            `,
            [store_id, limit]
          ),
          pool.query(
            `
            ${ctes}
            SELECT
              group_key,
              barcode,
              sku,
              product_name,
              brand,
              category,
              size_label,
              total_tags,
              in_stock_count,
              sold_count,
              returned_count,
              ROUND((${rateExpr}) * 100, 1) AS return_rate_pct,
              last_scan_at
            FROM product_rollup
            WHERE sold_count = 0
              AND in_stock_count > 0
            ORDER BY in_stock_count DESC, scanned_7d_count ASC, product_name ASC
            LIMIT $2
            `,
            [store_id, limit]
          ),
          pool.query(
            `
            ${ctes}
            SELECT
              COUNT(*) FILTER (WHERE in_stock_count BETWEEN 1 AND 2)::int AS low_stock_products,
              COUNT(*) FILTER (WHERE in_stock_count = 0 AND sold_count > 0)::int AS out_of_stock_products,
              COUNT(*) FILTER (
                WHERE sold_count > 0
                  AND (${rateExpr}) >= 0.25
                  AND returned_count > 0
              )::int AS high_return_rate_products,
              COUNT(*) FILTER (WHERE scanned_7d_count = 0)::int AS never_scanned_7d_products,
              COALESCE(
                SUM(in_stock_count) FILTER (WHERE in_stock_count BETWEEN 1 AND 2),
                0
              )::int AS low_stock_units,
              COALESCE(
                SUM(sold_count) FILTER (WHERE in_stock_count = 0 AND sold_count > 0),
                0
              )::int AS out_of_stock_demand_units,
              COALESCE(
                SUM(sold_count) FILTER (
                  WHERE sold_count > 0
                    AND (${rateExpr}) >= 0.25
                    AND returned_count > 0
                ),
                0
              )::int AS high_return_sold_units,
              COALESCE(
                SUM(in_stock_count) FILTER (WHERE scanned_7d_count = 0),
                0
              )::int AS never_scanned_units,
              COALESCE(
                SUM(in_stock_count) FILTER (
                  WHERE (in_stock_count BETWEEN 1 AND 2)
                     OR (in_stock_count = 0 AND sold_count > 0)
                     OR (sold_count > 0 AND (${rateExpr}) >= 0.25 AND returned_count > 0)
                     OR (scanned_7d_count = 0)
                ),
                0
              )::int AS at_risk_units
            FROM product_rollup
            `,
            [store_id]
          ),
          pool.query(
            `
            ${ctes}
            SELECT
              group_key,
              barcode,
              sku,
              product_name,
              brand,
              category,
              size_label,
              total_tags,
              in_stock_count,
              sold_count,
              returned_count,
              scanned_7d_count,
              last_scan_at,
              CASE
                WHEN last_scan_at IS NULL THEN NULL
                ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - last_scan_at)) / 86400)::int
              END AS days_since_scan,
              ROUND((${rateExpr}) * 100, 1) AS return_rate_pct,
              (in_stock_count BETWEEN 1 AND 2) AS risk_low_stock,
              (in_stock_count = 0 AND sold_count > 0) AS risk_out_of_stock,
              (sold_count > 0 AND (${rateExpr}) >= 0.25 AND returned_count > 0) AS risk_high_return_rate,
              (scanned_7d_count = 0) AS risk_never_scanned_7d
            FROM product_rollup
            WHERE (in_stock_count BETWEEN 1 AND 2)
               OR (in_stock_count = 0 AND sold_count > 0)
               OR (sold_count > 0 AND (${rateExpr}) >= 0.25 AND returned_count > 0)
               OR (scanned_7d_count = 0)
            ORDER BY
              risk_out_of_stock DESC,
              risk_high_return_rate DESC,
              risk_low_stock DESC,
              risk_never_scanned_7d DESC,
              sold_count DESC,
              in_stock_count ASC
            LIMIT $2
            `,
            [store_id, risk_limit]
          ),
          pool.query(
            `
            ${ctes}
            SELECT
              COALESCE(NULLIF(TRIM(brand), ''), 'Unbranded') AS brand,
              COALESCE(
                SUM(in_stock_count) FILTER (WHERE in_stock_count BETWEEN 1 AND 2),
                0
              )::int AS low_stock_units,
              COALESCE(
                SUM(sold_count) FILTER (WHERE in_stock_count = 0 AND sold_count > 0),
                0
              )::int AS out_of_stock_demand_units,
              COALESCE(
                SUM(sold_count) FILTER (
                  WHERE sold_count > 0
                    AND (${rateExpr}) >= 0.25
                    AND returned_count > 0
                ),
                0
              )::int AS high_return_sold_units,
              COALESCE(
                SUM(in_stock_count) FILTER (WHERE scanned_7d_count = 0),
                0
              )::int AS never_scanned_units,
              COALESCE(
                SUM(
                  CASE
                    WHEN (in_stock_count BETWEEN 1 AND 2)
                      OR (in_stock_count = 0 AND sold_count > 0)
                      OR (sold_count > 0 AND (${rateExpr}) >= 0.25 AND returned_count > 0)
                      OR (scanned_7d_count = 0)
                    THEN in_stock_count + sold_count
                    ELSE 0
                  END
                ),
                0
              )::int AS at_risk_units,
              MAX(
                CASE
                  WHEN scanned_7d_count = 0 AND last_scan_at IS NOT NULL
                    THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - last_scan_at)) / 86400)::int
                  WHEN scanned_7d_count = 0
                    THEN 7
                  ELSE 0
                END
              )::int AS max_no_scan_days
            FROM product_rollup
            GROUP BY COALESCE(NULLIF(TRIM(brand), ''), 'Unbranded')
            HAVING
              COALESCE(
                SUM(in_stock_count) FILTER (WHERE in_stock_count BETWEEN 1 AND 2),
                0
              ) > 0
              OR COALESCE(
                SUM(sold_count) FILTER (WHERE in_stock_count = 0 AND sold_count > 0),
                0
              ) > 0
              OR COALESCE(
                SUM(sold_count) FILTER (
                  WHERE sold_count > 0
                    AND (${rateExpr}) >= 0.25
                    AND returned_count > 0
                ),
                0
              ) > 0
              OR COALESCE(
                SUM(in_stock_count) FILTER (WHERE scanned_7d_count = 0),
                0
              ) > 0
            ORDER BY
              out_of_stock_demand_units DESC,
              high_return_sold_units DESC,
              low_stock_units DESC,
              never_scanned_units DESC,
              at_risk_units DESC
            LIMIT $2
            `,
            [store_id, risk_limit]
          ),
        ]);

      return res.json({
        ok: true,
        store_id,
        top_movers: topMoversResult.rows || [],
        dead_stock: deadStockResult.rows || [],
        risks: riskSummaryResult.rows?.[0] || {
          low_stock_products: 0,
          out_of_stock_products: 0,
          high_return_rate_products: 0,
          never_scanned_7d_products: 0,
          low_stock_units: 0,
          out_of_stock_demand_units: 0,
          high_return_sold_units: 0,
          never_scanned_units: 0,
          at_risk_units: 0,
        },
        risk_items: riskItemsResult.rows || [],
        brand_risks: brandRisksResult.rows || [],
      });
    } catch (err) {
      console.error("[stock/insights]", err);
      return res.status(500).json({ ok: false, error: "Failed to load stock insights" });
    }
  });

  return router;
};
