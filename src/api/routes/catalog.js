const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("./lib/catalogTable");
const { writeAuditLog } = require("./lib/audit");

const BARCODE_SQL = `
  COALESCE(
    NULLIF(TRIM(metadata->>'barcode'), ''),
    NULLIF(TRIM(metadata->>'upc'), ''),
    NULLIF(TRIM(metadata->>'ean'), ''),
    NULLIF(TRIM(metadata->>'gtin'), ''),
    NULLIF(TRIM(metadata->>'bar_code'), '')
  )
`;
const REAL_CATALOG_ROW_SQL = `LOWER(COALESCE(metadata->>'auto_mapped', 'false')) <> 'true'`;

function normalizeEpc(v) {
  return String(v || "").trim().toUpperCase();
}

function normalizeBarcode(v) {
  return String(v || "").trim().toUpperCase();
}

function normalizeEpcList(input, limit = 500) {
  return Array.from(
    new Set(
      (Array.isArray(input) ? input : [])
        .map((item) => normalizeEpc(item))
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function createActionRef(prefix) {
  return `${String(prefix || "ACT").toUpperCase()}-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function actorFromRequest(req) {
  return {
    actor_user_id: Number(req.user?.user_id) || null,
    actor_email: String(req.user?.email || "").trim().toLowerCase() || null,
  };
}

function mapCatalogRow(row) {
  const metadata =
    row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};

  return {
    store_id: row.store_id,
    epc: row.epc,
    barcode: row.barcode || null,
    sku: row.sku || null,
    product_name: row.product_name || null,
    brand: row.brand || null,
    category: row.category || null,
    size_label: row.size_label || null,
    color: row.color || null,
    price_lkr: row.price_lkr != null ? Number(row.price_lkr) : null,
    bin: metadata.bin || null,
    laundry_status: metadata.laundry_status || metadata.laundryStatus || null,
    notes: metadata.notes || null,
    stock: metadata.stock != null ? Number(metadata.stock) : null,
    metadata,
    updated_at: row.updated_at || null,
  };
}

async function tableExists(pool, tableName) {
  const result = await pool.query(`SELECT to_regclass($1) AS regclass_name`, [
    `public.${tableName}`,
  ]);
  return Boolean(result.rows[0]?.regclass_name);
}

module.exports = function buildCatalogRoutes(pool) {
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

    return allowedStores.includes(store_id);
  }

  async function loadCatalogRowsByEpcs(storeId, epcs) {
    if (!epcs.length) return [];

    const result = await pool.query(
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
      FROM catalog_items
      WHERE store_id = $1
        AND epc = ANY($2::varchar[])
        AND ${REAL_CATALOG_ROW_SQL}
      ORDER BY epc ASC
      `,
      [storeId, epcs]
    );

    return result.rows.map(mapCatalogRow);
  }

  router.use(authenticate);

  router.get("/", async (req, res) => {
    try {
      const store_id = req.query.store_id ? String(req.query.store_id) : null;
      const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const result = await pool.query(
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
        FROM catalog_items
        WHERE store_id = $1
          AND ${REAL_CATALOG_ROW_SQL}
        ORDER BY product_name ASC, epc ASC
        LIMIT $2
        `,
        [store_id, limit]
      );

      return res.json({
        ok: true,
        store_id,
        count: result.rowCount,
        items: result.rows.map(mapCatalogRow),
      });
    } catch (err) {
      console.error("[catalog] list error:", err);
      return res.status(500).json({ ok: false, error: "Failed to fetch catalog" });
    }
  });

  router.get("/lookup", async (req, res) => {
    try {
      const store_id = String(req.query.store_id || "").trim();
      const epc = normalizeEpc(req.query.epc);
      const barcode = normalizeBarcode(req.query.barcode);
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 250);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!epc && !barcode) {
        return res.status(400).json({ ok: false, error: "epc or barcode required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      if (epc) {
        const result = await pool.query(
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
          FROM catalog_items
          WHERE store_id = $1
            AND epc = $2
            AND ${REAL_CATALOG_ROW_SQL}
          LIMIT 1
          `,
          [store_id, epc]
        );

        return res.json({
          ok: true,
          store_id,
          epc,
          found: result.rowCount > 0,
          item: result.rows[0] ? mapCatalogRow(result.rows[0]) : null,
        });
      }

      const [countResult, result] = await Promise.all([
        pool.query(
          `
          SELECT COUNT(*)::int AS matched_count
          FROM catalog_items
          WHERE store_id = $1
            AND UPPER(COALESCE(${BARCODE_SQL}, '')) = $2
            AND ${REAL_CATALOG_ROW_SQL}
          `,
          [store_id, barcode]
        ),
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
          FROM catalog_items
          WHERE store_id = $1
            AND UPPER(COALESCE(${BARCODE_SQL}, '')) = $2
            AND ${REAL_CATALOG_ROW_SQL}
          ORDER BY product_name ASC, epc ASC
          LIMIT $3
          `,
          [store_id, barcode, limit]
        ),
      ]);

      return res.json({
        ok: true,
        store_id,
        barcode,
        count: Number(countResult.rows[0]?.matched_count || 0),
        returned_count: result.rowCount,
        items: result.rows.map(mapCatalogRow),
      });
    } catch (err) {
      console.error("[catalog/lookup]", err);
      return res.status(500).json({ ok: false, error: "Failed to look up catalog items" });
    }
  });

  router.post("/lookup/batch", async (req, res) => {
    try {
      const store_id = String(req.body?.store_id || "").trim();
      const epcs = normalizeEpcList(req.body?.epcs, 500);

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!epcs.length) {
        return res.status(400).json({ ok: false, error: "epcs required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const rows = await loadCatalogRowsByEpcs(store_id, epcs);
      const byEpc = new Map(rows.map((row) => [row.epc, row]));
      const items = epcs.map((epcValue) => {
        const item = byEpc.get(epcValue);
        if (item) {
          return { ...item, found: true };
        }

        return {
          store_id,
          epc: epcValue,
          barcode: null,
          sku: null,
          product_name: null,
          brand: null,
          category: null,
          size_label: null,
          color: null,
          price_lkr: null,
          updated_at: null,
          found: false,
        };
      });

      return res.json({
        ok: true,
        store_id,
        count: items.length,
        found_count: items.filter((item) => item.found).length,
        missing_count: items.filter((item) => !item.found).length,
        items,
      });
    } catch (err) {
      console.error("[catalog/lookup/batch]", err);
      return res.status(500).json({ ok: false, error: "Failed to look up EPC batch" });
    }
  });

  router.post("/assign-items", async (req, res) => {
    try {
      const store_id = String(req.body?.store_id || "").trim();
      const barcode = normalizeBarcode(req.body?.barcode);
      const epcs = normalizeEpcList(req.body?.epcs, 500);
      const quantity = Number(req.body?.quantity || epcs.length || 0);
      const device_id = String(req.body?.device_id || "").trim() || null;

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!barcode) {
        return res.status(400).json({ ok: false, error: "barcode required" });
      }

      if (!epcs.length) {
        return res.status(400).json({ ok: false, error: "epcs required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(pool);

      const barcodeCheck = await pool.query(
        `
        SELECT COUNT(*)::int AS matched_count
        FROM catalog_items
        WHERE store_id = $1
          AND UPPER(COALESCE(${BARCODE_SQL}, '')) = $2
        `,
        [store_id, barcode]
      );

      if (Number(barcodeCheck.rows[0]?.matched_count || 0) <= 0) {
        return res.status(404).json({
          ok: false,
          error: "Barcode not found in catalog for this store",
        });
      }

      if (quantity !== epcs.length) {
        return res.status(400).json({
          ok: false,
          error: "Scanned EPC count does not match requested quantity",
          requested_quantity: quantity,
          scanned_count: epcs.length,
        });
      }

      const rows = await loadCatalogRowsByEpcs(store_id, epcs);
      const byEpc = new Map(rows.map((row) => [row.epc, row]));
      const missing_epcs = epcs.filter((epcValue) => !byEpc.has(epcValue));
      const mismatched_epcs = epcs
        .map((epcValue) => byEpc.get(epcValue))
        .filter((row) => row && normalizeBarcode(row.barcode) !== barcode)
        .map((row) => ({
          epc: row.epc,
          barcode: row.barcode,
          sku: row.sku,
          product_name: row.product_name,
        }));

      if (missing_epcs.length || mismatched_epcs.length) {
        return res.status(400).json({
          ok: false,
          error: "One or more scanned EPCs do not match the requested barcode",
          missing_epcs,
          mismatched_epcs,
        });
      }

      const assignment_id = createActionRef("HHA");
      await writeAuditLog(pool, {
        ...actorFromRequest(req),
        action: "HANDHELD_ASSIGN_ITEMS",
        entity_type: "HANDHELD_ASSIGNMENT",
        entity_id: assignment_id,
        store_id,
        metadata: {
          barcode,
          quantity,
          epcs,
          device_id,
        },
      });

      return res.json({
        ok: true,
        assignment: {
          assignment_id,
          store_id,
          barcode,
          quantity_requested: quantity,
          quantity_confirmed: epcs.length,
          device_id,
          epcs,
          items: rows,
        },
      });
    } catch (err) {
      console.error("[catalog/assign-items]", err);
      return res.status(500).json({ ok: false, error: "Failed to assign items" });
    }
  });

  router.post("/upsert-item", async (req, res) => {
    const client = await pool.connect();
    try {
      const store_id = String(req.body?.store_id || "").trim();
      const epc = normalizeEpc(req.body?.epc);
      const sku = String(req.body?.sku || "").trim() || null;
      const product_name = String(
        req.body?.product_name || req.body?.name || ""
      ).trim();
      const brand = String(req.body?.brand || "").trim() || null;
      const category =
        String(req.body?.category || "").trim() || "Uncategorized";
      const size_label =
        String(req.body?.size_label || req.body?.size || "").trim() || null;
      const color = String(req.body?.color || "").trim() || null;
      const barcode = normalizeBarcode(req.body?.barcode);
      const bin = String(req.body?.bin || "").trim() || null;
      const notes = String(req.body?.notes || "").trim() || null;
      const laundry_status =
        String(req.body?.laundry_status || req.body?.laundryStatus || "").trim() ||
        null;
      const stockRaw = Number(req.body?.stock);
      const stock = Number.isFinite(stockRaw) ? Math.max(Math.round(stockRaw), 0) : null;
      const priceRaw =
        req.body?.price_lkr != null ? req.body.price_lkr : req.body?.price;
      const priceParsed = Number(priceRaw);
      const price_lkr = Number.isFinite(priceParsed)
        ? Math.max(Number(priceParsed.toFixed(2)), 0)
        : 0;

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!epc) {
        return res.status(400).json({ ok: false, error: "epc required" });
      }

      if (!product_name) {
        return res.status(400).json({ ok: false, error: "product_name required" });
      }

      if (!canAccessStore(req, store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(client);
      await client.query("BEGIN");

      // Manual assignment should always promote a tag out of the auto-mapped bucket
      // so it becomes visible across catalog, stock, POS, and assignment views.
      const metadata = {
        auto_mapped: false,
        ...(barcode ? { barcode } : {}),
        ...(bin ? { bin } : {}),
        ...(notes ? { notes } : {}),
        ...(laundry_status ? { laundry_status } : {}),
        ...(stock != null ? { stock } : {}),
      };

      const upsertResult = await client.query(
        `
        INSERT INTO catalog_items (
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
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::jsonb, NOW()
        )
        ON CONFLICT (store_id, epc)
        DO UPDATE SET
          sku = EXCLUDED.sku,
          product_name = EXCLUDED.product_name,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          size_label = EXCLUDED.size_label,
          color = EXCLUDED.color,
          price_lkr = EXCLUDED.price_lkr,
          metadata = (COALESCE(catalog_items.metadata, '{}'::jsonb) - 'auto_mapped') || EXCLUDED.metadata,
          updated_at = NOW()
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
          metadata,
          updated_at,
          ${BARCODE_SQL} AS barcode
        `,
        [
          store_id,
          epc,
          sku,
          product_name,
          brand,
          category,
          size_label,
          color,
          price_lkr,
          JSON.stringify(metadata),
        ]
      );

      const item = mapCatalogRow(upsertResult.rows[0]);
      await writeAuditLog(client, {
        ...actorFromRequest(req),
        action: "CATALOG_ITEM_UPSERT",
        entity_type: "CATALOG_ITEM",
        entity_id: `${store_id}:${epc}`,
        store_id,
        metadata: {
          epc,
          sku,
          barcode: barcode || null,
          product_name,
          brand,
          category,
          size_label,
          color,
          price_lkr,
          bin,
          laundry_status,
          stock,
        },
      });

      await client.query("COMMIT");

      return res.json({ ok: true, item });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[catalog/upsert-item]", err);
      return res.status(500).json({ ok: false, error: "Failed to save catalog item" });
    } finally {
      client.release();
    }
  });

  router.post("/transfer", async (req, res) => {
    const client = await pool.connect();
    try {
      const source_store_id = String(
        req.body?.source_store_id || req.body?.store_id || ""
      ).trim();
      const destination_store_id = String(req.body?.destination_store_id || "").trim();
      const epcs = normalizeEpcList(req.body?.epcs, 500);
      const device_id = String(req.body?.device_id || "").trim() || null;

      if (!source_store_id) {
        return res.status(400).json({ ok: false, error: "source_store_id required" });
      }

      if (!destination_store_id) {
        return res
          .status(400)
          .json({ ok: false, error: "destination_store_id required" });
      }

      if (source_store_id === destination_store_id) {
        return res.status(400).json({
          ok: false,
          error: "Source and destination store cannot be the same",
        });
      }

      if (!epcs.length) {
        return res.status(400).json({ ok: false, error: "epcs required" });
      }

      if (!canAccessStore(req, source_store_id) || !canAccessStore(req, destination_store_id)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      await ensureCatalogTable(client);
      await client.query("BEGIN");

      const sourceRows = await client.query(
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
          updated_at,
          ${BARCODE_SQL} AS barcode
        FROM catalog_items
        WHERE store_id = $1
          AND epc = ANY($2::varchar[])
        ORDER BY epc ASC
        `,
        [source_store_id, epcs]
      );

      const sourceItems = sourceRows.rows.map(mapCatalogRow);
      const sourceByEpc = new Map(sourceItems.map((row) => [row.epc, row]));
      const missing_epcs = epcs.filter((epcValue) => !sourceByEpc.has(epcValue));

      if (missing_epcs.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "One or more EPCs are not present in the source store catalog",
          missing_epcs,
        });
      }

      const destinationConflicts = await client.query(
        `
        SELECT epc
        FROM catalog_items
        WHERE store_id = $1
          AND epc = ANY($2::varchar[])
        ORDER BY epc ASC
        `,
        [destination_store_id, epcs]
      );

      if (destinationConflicts.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "One or more EPCs already exist in the destination store",
          conflicting_epcs: destinationConflicts.rows.map((row) => row.epc),
        });
      }

      await client.query(
        `
        UPDATE catalog_items
        SET store_id = $2,
            updated_at = NOW()
        WHERE store_id = $1
          AND epc = ANY($3::varchar[])
        `,
        [source_store_id, destination_store_id, epcs]
      );

      if (await tableExists(client, "tag_registry")) {
        await client.query(
          `
          UPDATE tag_registry
          SET store_id = $2,
              updated_at = NOW()
          WHERE store_id = $1
            AND epc = ANY($3::varchar[])
          `,
          [source_store_id, destination_store_id, epcs]
        );
      }

      const transfer_id = createActionRef("HHT");
      await writeAuditLog(client, {
        ...actorFromRequest(req),
        action: "HANDHELD_TRANSFER_STORE",
        entity_type: "HANDHELD_TRANSFER",
        entity_id: transfer_id,
        store_id: source_store_id,
        metadata: {
          source_store_id,
          destination_store_id,
          device_id,
          epcs,
        },
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        transfer: {
          transfer_id,
          source_store_id,
          destination_store_id,
          device_id,
          moved_count: epcs.length,
          epcs,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[catalog/transfer]", err);
      return res.status(500).json({ ok: false, error: "Failed to transfer items" });
    } finally {
      client.release();
    }
  });

  return router;
};
