// src/api/routes/pos.js
const express = require("express");
const jwt = require("jsonwebtoken");
const { ensureCatalogTable } = require("./lib/catalogTable");
const { validationLabel } = require("./lib/retailValidation");

module.exports = function buildPosRoutes(pool) {
  const router = express.Router();

  function normalizedRoles(req) {
    const roleList = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const singleRole = req.user?.role ? [req.user.role] : [];
    return Array.from(
      new Set(
        [...roleList, ...singleRole]
          .map((r) => String(r || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }

  function normalizeMetadata(metadata, txnType, extra = {}) {
    const base =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : {};
    return { ...base, ...extra, txn_type: txnType };
  }

  function normalizeItems(items = []) {
    const unique = new Map();

    for (const item of items) {
      if (!item) continue;
      const epc = item.epc && String(item.epc).trim();
      if (!epc) continue;

      const rawPrice =
        typeof item.price === "number"
          ? item.price
          : item.price != null
          ? Number(item.price)
          : 0;
      const price = Number.isFinite(rawPrice) ? rawPrice : 0;

      if (!unique.has(epc)) {
        unique.set(epc, { epc, price });
      }
    }

    return Array.from(unique.values());
  }

  function canAccessStore(req, storeId) {
    if (!storeId) return false;
    if (isAdminUser(req)) return true;

    const allowedStores = Array.isArray(req.user?.store_ids) ? req.user.store_ids : [];
    return allowedStores.includes(storeId);
  }

  function buildCartValidation(row) {
    if (!row?.sku && !row?.product_name) {
      return {
        validation_status: "UNKNOWN_EPC",
        validation_label: validationLabel("UNKNOWN_EPC"),
        validation_message: "No catalog item is mapped to this EPC in the selected store.",
      };
    }

    if (row?.sold_before) {
      return {
        validation_status: "ALREADY_BILLED",
        validation_label: validationLabel("ALREADY_BILLED"),
        validation_message: "This EPC already exists in POS sale history for the selected store.",
      };
    }

    return {
      validation_status: "MATCHED",
      validation_label: validationLabel("MATCHED"),
      validation_message: "Item matched to catalog and is ready for POS.",
    };
  }

  /* =========================
     AUTH (JWT for dashboard)
  ========================= */
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

  function isAdminUser(req) {
    const roles = normalizedRoles(req);
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function optionalAuthenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return next();
    if (!auth.startsWith("Bearer ")) return next();

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  /* =========================
     POS KEY AUTH (for POS upload)
     - Admin OR POS_API_KEY can write
  ========================= */
  function authenticatePosWriter(req, res, next) {
    // Admin users can write.
    if (req.user && isAdminUser(req)) {
      return next();
    }

    // Allow POS system via key
    const key =
      req.headers["x-pos-key"] ||
      req.headers["x-api-key"] ||
      req.headers["x-zyro-pos-key"];

    const expected = process.env.POS_API_KEY;

    if (!expected) {
      console.warn(
        "[pos] POS_API_KEY not set. Blocking POS write endpoints for safety."
      );
      return res.status(500).json({
        ok: false,
        error: "Server misconfigured (POS_API_KEY missing)",
      });
    }

    if (!key || String(key).trim() !== String(expected).trim()) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden (admin or pos key required)",
      });
    }

    return next();
  }

 // --------------------------------------
// GET /api/v1/pos (READ)
// --------------------------------------
// List recent POS transactions (optionally filtered by store_id)
router.get("/", authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const store_id = req.query.store_id ? String(req.query.store_id) : null;

    if (store_id && !canAccessStore(req, store_id)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const result = store_id
      ? await pool.query(
          `
          SELECT
            id,
            ext_id,
            total_amount,
            total_items,
            store_id,
            created_at,
            metadata
          FROM pos_transactions
          WHERE store_id = $1
          ORDER BY created_at DESC
          LIMIT $2
          `,
          [store_id, limit]
        )
      : await pool.query(
          `
          SELECT
            id,
            ext_id,
            total_amount,
            total_items,
            store_id,
            created_at,
            metadata
          FROM pos_transactions
          ORDER BY created_at DESC
          LIMIT $1
          `,
          [limit]
        );

    res.json({
      ok: true,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (err) {
    console.error("[pos] GET / error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Failed to fetch POS transactions" });
  }
});

// --------------------------------------
// GET /api/v1/pos/cart-items (READ)
// --------------------------------------
// Recent scanned EPCs with product metadata for POS cart building
router.get("/cart-items", authenticate, async (req, res) => {
  try {
    const store_id = req.query.store_id ? String(req.query.store_id) : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);

    if (!store_id) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }

    if (!canAccessStore(req, store_id)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    let includeCatalog = true;
    try {
      await ensureCatalogTable(pool);
    } catch {
      includeCatalog = false;
      console.warn("[pos/cart-items] catalog unavailable, returning raw tags");
    }

    const result = includeCatalog
      ? await pool.query(
          `
          SELECT
            s.tag AS epc,
            COALESCE(SUM(s.read_count), COUNT(*))::int AS read_count,
            MAX(COALESCE(s.last_seen, s.ts)) AS last_seen,
            c.sku,
            c.product_name,
            c.brand,
            c.category,
            c.size_label,
            c.color,
            c.price_lkr,
            (
              COALESCE((
                SELECT SUM(
                  CASE
                    WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                      OR COALESCE(pt.total_amount, 0) < 0
                      OR COALESCE(pt.total_items, 0) < 0
                      THEN -1
                    ELSE 1
                  END
                )
                FROM pos_transaction_items pti
                JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
                WHERE pti.epc = s.tag
                  AND pt.store_id = $1
              ), 0) > 0
            ) AS sold_before
          FROM scan_items s
          LEFT JOIN catalog_items c
            ON c.store_id = $1
           AND c.epc = s.tag
          WHERE s.store_id = $1
            AND COALESCE(s.last_seen, s.ts) >= NOW() - ($3::int * INTERVAL '1 hour')
          GROUP BY
            s.tag,
            c.sku,
            c.product_name,
            c.brand,
            c.category,
            c.size_label,
            c.color,
            c.price_lkr
          ORDER BY MAX(COALESCE(s.last_seen, s.ts)) DESC
          LIMIT $2
          `,
          [store_id, limit, hours]
        )
      : await pool.query(
          `
          SELECT
            s.tag AS epc,
            COALESCE(SUM(s.read_count), COUNT(*))::int AS read_count,
            MAX(COALESCE(s.last_seen, s.ts)) AS last_seen,
            NULL::varchar AS sku,
            NULL::varchar AS product_name,
            NULL::varchar AS brand,
            NULL::varchar AS category,
            NULL::varchar AS size_label,
            NULL::varchar AS color,
            NULL::numeric AS price_lkr,
            (
              COALESCE((
                SELECT SUM(
                  CASE
                    WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
                      OR COALESCE(pt.total_amount, 0) < 0
                      OR COALESCE(pt.total_items, 0) < 0
                      THEN -1
                    ELSE 1
                  END
                )
                FROM pos_transaction_items pti
                JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
                WHERE pti.epc = s.tag
                  AND pt.store_id = $1
              ), 0) > 0
            ) AS sold_before
          FROM scan_items s
          WHERE s.store_id = $1
            AND COALESCE(s.last_seen, s.ts) >= NOW() - ($3::int * INTERVAL '1 hour')
          GROUP BY s.tag
          ORDER BY MAX(COALESCE(s.last_seen, s.ts)) DESC
          LIMIT $2
          `,
          [store_id, limit, hours]
        );

    const items = result.rows.map((row) => ({
      ...row,
      ...buildCartValidation(row),
    }));

    return res.json({
      ok: true,
      store_id,
      count: items.length,
      items,
    });
  } catch (err) {
    console.error("[pos] GET /cart-items error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch cart items",
    });
  }
});

  // --------------------------------------
  // POST /api/v1/pos/return (WRITE)
  // --------------------------------------
  router.post("/return", optionalAuthenticate, authenticatePosWriter, async (req, res) => {
    try {
      const { ext_id, store_id, metadata, reason } = req.body || {};
      let { total_amount, items } = req.body || {};

      if (!store_id) {
        return res.status(400).json({ ok: false, error: "store_id required" });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            "No items provided. Expecting { items: [ { epc, price? }, ... ] }",
        });
      }

      const normalizedItems = normalizeItems(items);
      if (normalizedItems.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No valid items with epc found.",
        });
      }

      if (ext_id) {
        const existing = await pool.query(
          `
          SELECT *
          FROM pos_transactions
          WHERE ext_id = $1
          LIMIT 1
          `,
          [ext_id]
        );

        if (existing.rowCount) {
          return res.json({
            ok: true,
            idempotent: true,
            transaction: existing.rows[0],
            items_count: Math.abs(Number(existing.rows[0]?.total_items || 0)),
          });
        }
      }

      const epcs = normalizedItems.map((item) => item.epc);
      const stateResult = await pool.query(
        `
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
          )::int AS sold_balance
        FROM pos_transaction_items pti
        JOIN pos_transactions pt
          ON pt.id = pti.pos_txn_id
        WHERE pt.store_id = $1
          AND pti.epc = ANY($2::varchar[])
        GROUP BY pti.epc
        `,
        [store_id, epcs]
      );

      const soldBalance = new Map(
        stateResult.rows.map((row) => [String(row.epc), Number(row.sold_balance || 0)])
      );

      const notReturnable = epcs.filter((epc) => (soldBalance.get(epc) || 0) <= 0);
      if (notReturnable.length) {
        return res.status(400).json({
          ok: false,
          error: "Some EPCs are not currently sold, so they cannot be returned",
          epcs: notReturnable,
        });
      }

      const totalItems = normalizedItems.length;
      const computedAbsAmount = normalizedItems.reduce(
        (sum, item) => sum + Math.abs(Number(item.price || 0)),
        0
      );

      if (
        total_amount == null ||
        (typeof total_amount !== "number" && isNaN(Number(total_amount)))
      ) {
        total_amount = -computedAbsAmount;
      } else {
        total_amount = -Math.abs(Number(total_amount));
      }

      const returnMetadata = normalizeMetadata(metadata, "RETURN", {
        reason: reason || null,
      });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertTxn = await client.query(
          `
          INSERT INTO pos_transactions (
            ext_id,
            total_amount,
            total_items,
            store_id,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [
            ext_id || null,
            total_amount,
            -totalItems,
            store_id,
            returnMetadata,
          ]
        );

        const posRow = insertTxn.rows[0];
        const posTxnId = posRow.id;

        const values = [];
        const placeholders = [];
        let idx = 1;

        for (const item of normalizedItems) {
          placeholders.push(`($${idx++}, $${idx++}, $${idx++})`);
          values.push(posTxnId, item.epc, -Math.abs(Number(item.price || 0)));
        }

        if (placeholders.length) {
          const insertItemsSql = `
            INSERT INTO pos_transaction_items (pos_txn_id, epc, price)
            VALUES ${placeholders.join(", ")}
          `;
          await client.query(insertItemsSql, values);
        }

        try {
          const tagEventValues = [];
          const tagEventPlaceholders = [];
          idx = 1;

          for (const item of normalizedItems) {
            tagEventPlaceholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++})`
            );
            tagEventValues.push(
              item.epc,
              "POS_RETURN",
              store_id || null,
              JSON.stringify({
                pos_txn_id: posTxnId,
                ext_id: ext_id || null,
                reason: reason || null,
                amount: -Math.abs(Number(item.price || 0)),
              })
            );
          }

          const tagEventSql = `
            INSERT INTO tag_events (epc, event_type, source, data)
            VALUES ${tagEventPlaceholders.join(", ")}
          `;
          await client.query(tagEventSql, tagEventValues);
        } catch (e) {
          console.warn("[pos] return tag_events insert failed (non-fatal):", e.message);
        }

        await client.query("COMMIT");

        return res.json({
          ok: true,
          transaction: posRow,
          items_count: totalItems,
        });
      } catch (txErr) {
        await client.query("ROLLBACK");
        console.error("[pos] POST /return transaction error:", txErr);
        return res
          .status(500)
          .json({ ok: false, error: "Failed to persist POS return" });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[pos] POST /return error:", err);
      return res.status(500).json({ ok: false, error: "Failed to process POS return" });
    }
  });


  // --------------------------------------
  // POST /api/v1/pos/upload (WRITE)
  // --------------------------------------
  router.post("/upload", optionalAuthenticate, authenticatePosWriter, async (req, res) => {
    try {
      const { ext_id, store_id, metadata } = req.body || {};
      let { total_amount, items } = req.body || {};

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            "No items provided. Expecting { items: [ { epc, price? }, ... ] }",
        });
      }

      // Normalize & filter items
      const normalizedItems = normalizeItems(items);

      if (normalizedItems.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No valid items with epc found.",
        });
      }

      const saleMetadata = normalizeMetadata(metadata, "SALE");
      const totalItems = normalizedItems.length;

      // If total_amount not provided, compute from prices
      if (
        total_amount == null ||
        (typeof total_amount !== "number" && isNaN(Number(total_amount)))
      ) {
        total_amount = normalizedItems.reduce(
          (sum, item) => sum + (item.price || 0),
          0
        );
      } else {
        total_amount = Number(total_amount);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        let posTxnId = null;
        let posRow = null;

        if (ext_id) {
          // Try to find existing txn by ext_id (idempotency)
          const existing = await client.query(
            `
            SELECT id
            FROM pos_transactions
            WHERE ext_id = $1
            FOR UPDATE
            `,
            [ext_id]
          );

          if (existing.rowCount > 0) {
            posTxnId = existing.rows[0].id;

            const updateResult = await client.query(
              `
              UPDATE pos_transactions
              SET
                total_amount = $2,
                total_items  = $3,
                store_id     = $4,
                metadata     = $5,
                created_at   = COALESCE(created_at, NOW())
              WHERE id = $1
              RETURNING *
              `,
              [
                posTxnId,
                total_amount,
                totalItems,
                store_id || null,
                saleMetadata,
              ]
            );

            posRow = updateResult.rows[0];
          } else {
            // Insert new txn
            const insertResult = await client.query(
              `
              INSERT INTO pos_transactions (
                ext_id,
                total_amount,
                total_items,
                store_id,
                metadata
              )
              VALUES ($1, $2, $3, $4, $5)
              RETURNING *
              `,
              [
                ext_id,
                total_amount,
                totalItems,
                store_id || null,
                saleMetadata,
              ]
            );

            posRow = insertResult.rows[0];
            posTxnId = posRow.id;
          }
        } else {
          // No ext_id -> always create new txn
          const insertResult = await client.query(
            `
            INSERT INTO pos_transactions (
              ext_id,
              total_amount,
              total_items,
              store_id,
              metadata
            )
            VALUES (NULL, $1, $2, $3, $4)
            RETURNING *
            `,
            [total_amount, totalItems, store_id || null, saleMetadata]
          );

          posRow = insertResult.rows[0];
          posTxnId = posRow.id;
        }

        // Replace items for this transaction
        await client.query(
          `
          DELETE FROM pos_transaction_items
          WHERE pos_txn_id = $1
          `,
          [posTxnId]
        );

        const values = [];
        const placeholders = [];
        let idx = 1;

        for (const item of normalizedItems) {
          placeholders.push(`($${idx++}, $${idx++}, $${idx++})`);
          values.push(posTxnId, item.epc, item.price || 0);
        }

        const insertItemsSql = `
          INSERT INTO pos_transaction_items (pos_txn_id, epc, price)
          VALUES ${placeholders.join(", ")}
        `;

        await client.query(insertItemsSql, values);

        // Optionally: write tag_events for each EPC (POS_SALE)
        try {
          const tagEventValues = [];
          const tagEventPlaceholders = [];
          idx = 1;

          for (const item of normalizedItems) {
            tagEventPlaceholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++})`
            );
            tagEventValues.push(
              item.epc,
              "POS_SALE",
              store_id || null,
              JSON.stringify({
                pos_txn_id: posTxnId,
                ext_id: ext_id || null,
                price: item.price || 0,
              })
            );
          }

          const tagEventSql = `
            INSERT INTO tag_events (epc, event_type, source, data)
            VALUES ${tagEventPlaceholders.join(", ")}
          `;

          await client.query(tagEventSql, tagEventValues);
        } catch (e) {
          console.warn("[pos] tag_events insert failed (non-fatal):", e.message);
        }

        await client.query("COMMIT");

        return res.json({
          ok: true,
          transaction: posRow,
          items_count: normalizedItems.length,
        });
      } catch (txErr) {
        await client.query("ROLLBACK");
        console.error("[pos] POST /upload transaction error:", txErr);
        return res
          .status(500)
          .json({ ok: false, error: "Failed to persist POS transaction" });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[pos] POST /upload error:", err);
      res.status(500).json({ ok: false, error: "Failed to handle POS upload" });
    }
  });

  return router;
};
