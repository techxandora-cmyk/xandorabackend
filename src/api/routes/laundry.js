const express = require("express");
const jwt = require("jsonwebtoken");

const ACTION_CONFIG = {
  checkout: {
    eventType: "CHECKOUT",
    toStatus: "OUT_WITH_CUSTOMER",
    defaultCycleIncrement: 0,
  },
  dispatch: {
    eventType: "CHECKOUT",
    toStatus: "OUT_WITH_CUSTOMER",
    defaultCycleIncrement: 0,
  },
  receive: {
    eventType: "RECEIVE",
    toStatus: "IN_STOCK",
    defaultCycleIncrement: 0,
  },
  return_to_stock: {
    eventType: "RECEIVE",
    toStatus: "IN_STOCK",
    defaultCycleIncrement: 0,
  },
  wash_start: {
    eventType: "WASH_START",
    toStatus: "IN_WASH",
    defaultCycleIncrement: 0,
  },
  wash_complete: {
    eventType: "WASH_COMPLETE",
    toStatus: "IN_STOCK",
    defaultCycleIncrement: 1,
  },
  mark_damaged: {
    eventType: "MARK_DAMAGED",
    toStatus: "DAMAGED",
    defaultCycleIncrement: 0,
  },
  mark_lost: {
    eventType: "MARK_LOST",
    toStatus: "LOST",
    defaultCycleIncrement: 0,
  },
  retire: {
    eventType: "RETIRE",
    toStatus: "RETIRED",
    defaultCycleIncrement: 0,
  },
  audit: {
    eventType: "AUDIT",
    toStatus: null,
    defaultCycleIncrement: 0,
  },
};

module.exports = function buildLaundryRoutes(pool) {
  const router = express.Router();

  function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      req.user = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  }

  function isAdminUser(req) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    return (
      roles.includes("MASTER_ADMIN") ||
      roles.includes("ADMIN") ||
      roles.includes("GLOBAL_ADMIN")
    );
  }

  function hasPermission(req, permission) {
    const permissions = Array.isArray(req.user?.permissions)
      ? req.user.permissions
      : [];
    return permissions.includes("*") || permissions.includes(permission);
  }

  function canAccessStore(req, storeId) {
    const normalizedStoreId = String(storeId || "").trim();
    if (!normalizedStoreId) return false;
    if (isAdminUser(req)) return true;

    const allowedStores = Array.isArray(req.user?.store_ids)
      ? req.user.store_ids
      : [];
    return allowedStores.includes(normalizedStoreId);
  }

  function canViewLaundry(req, storeId) {
    if (!canAccessStore(req, storeId)) return false;
    if (isAdminUser(req)) return true;
    return (
      hasPermission(req, "dashboard.view_laundry") ||
      hasPermission(req, "handheld.laundry_scan") ||
      hasPermission(req, "handheld.scan_items")
    );
  }

  function canManageLaundry(req, storeId) {
    if (!canAccessStore(req, storeId)) return false;
    if (isAdminUser(req)) return true;
    return hasPermission(req, "dashboard.manage_laundry");
  }

  function canUseLaundryScanner(req, storeId) {
    if (!canAccessStore(req, storeId)) return false;
    if (isAdminUser(req)) return true;
    return (
      hasPermission(req, "handheld.laundry_scan") ||
      hasPermission(req, "handheld.scan_items")
    );
  }

  function normalizeText(value, fallback = "") {
    return String(value ?? fallback).trim();
  }

  function normalizeTag(value) {
    return normalizeText(value).toUpperCase();
  }

  function clampInteger(value, { min = 0, max = 100000, fallback = 0 } = {}) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(Math.floor(numeric), min), max);
  }

  function normalizeAmount(value, fallback = null) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return Math.round(numeric * 100) / 100;
  }

  function normalizeAction(value) {
    return normalizeText(value).toLowerCase();
  }

  function deriveTypeCode(name) {
    return normalizeText(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
  }

  async function tableExists(tableName) {
    const r = await pool.query(`SELECT to_regclass($1) AS regclass_name`, [
      `public.${tableName}`,
    ]);
    return Boolean(r.rows[0]?.regclass_name);
  }

  async function resolveCompanyScope(req, storeId) {
    const tokenCompany = normalizeText(req.user?.company_name);
    if (tokenCompany && tokenCompany.toUpperCase() !== "XANDORA") {
      return tokenCompany;
    }

    const normalizedStoreId = normalizeText(storeId);
    if (!normalizedStoreId) {
      return tokenCompany || null;
    }

    try {
      if (await tableExists("company_stores")) {
        const companyStoreRes = await pool.query(
          `
          SELECT company_name
          FROM company_stores
          WHERE store_id = $1
          ORDER BY is_active DESC, updated_at DESC, created_at DESC
          LIMIT 1
          `,
          [normalizedStoreId]
        );

        const storeCompany = normalizeText(companyStoreRes.rows[0]?.company_name);
        if (storeCompany) return storeCompany;
      }
    } catch (e) {
      console.warn("[laundry] company_stores lookup failed:", e.message);
    }

    try {
      const fallback = await pool.query(
        `
        SELECT u.company_name
        FROM user_store_roles usr
        JOIN users u
          ON u.id = usr.user_id
        WHERE usr.store_id = $1
          AND COALESCE(u.company_name, '') <> ''
        ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC NULLS LAST
        LIMIT 1
        `,
        [normalizedStoreId]
      );

      const companyName = normalizeText(fallback.rows[0]?.company_name);
      if (companyName) return companyName;
    } catch (e) {
      console.warn("[laundry] fallback company lookup failed:", e.message);
    }

    return tokenCompany || null;
  }

  async function requireCompanyScope(req, res, storeId) {
    const companyName = await resolveCompanyScope(req, storeId);
    if (!companyName) {
      res.status(400).json({ ok: false, error: "Unable to resolve company scope" });
      return null;
    }
    return companyName;
  }

  router.use(authenticate);

  router.get("/summary", async (req, res) => {
    const storeId = normalizeText(req.query.store_id);
    if (!storeId) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }
    if (!canViewLaundry(req, storeId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      const summaryRes = await pool.query(
        `
        SELECT
          COUNT(*)::int AS total_items,
          COUNT(DISTINCT item_type_id)::int AS item_types,
          COALESCE(SUM(CASE WHEN status = 'IN_STOCK' THEN 1 ELSE 0 END), 0)::int AS in_stock,
          COALESCE(SUM(CASE WHEN status = 'OUT_WITH_CUSTOMER' THEN 1 ELSE 0 END), 0)::int AS out_with_customer,
          COALESCE(SUM(CASE WHEN status = 'IN_WASH' THEN 1 ELSE 0 END), 0)::int AS in_wash,
          COALESCE(SUM(CASE WHEN status = 'DAMAGED' THEN 1 ELSE 0 END), 0)::int AS damaged_items,
          COALESCE(SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END), 0)::int AS lost_items,
          COALESCE(SUM(CASE WHEN status = 'RETIRED' THEN 1 ELSE 0 END), 0)::int AS retired_items,
          COALESCE(SUM(CASE
            WHEN wash_cycle_count >= warning_cycle_threshold
             AND wash_cycle_count < max_wash_cycles
            THEN 1 ELSE 0 END), 0)::int AS nearing_end_of_life,
          COALESCE(SUM(CASE
            WHEN wash_cycle_count >= max_wash_cycles
            THEN 1 ELSE 0 END), 0)::int AS exceeded_cycles,
          COALESCE(AVG(wash_cycle_count), 0)::numeric(10,2) AS avg_wash_cycles
        FROM laundry_items
        WHERE company_name = $1
          AND store_id = $2
        `,
        [companyName, storeId]
      );

      return res.json({ ok: true, summary: summaryRes.rows[0] || {} });
    } catch (e) {
      console.error("[laundry/summary]", e);
      return res.status(500).json({ ok: false, error: "Failed to load laundry summary" });
    }
  });

  router.get("/item-types", async (req, res) => {
    const storeId = normalizeText(req.query.store_id);
    if (!storeId) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }
    if (!canViewLaundry(req, storeId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      const r = await pool.query(
        `
        SELECT
          t.id,
          t.company_name,
          t.code,
          t.name,
          t.category,
          t.fabric_type,
          t.size_label,
          t.unit_price,
          t.max_wash_cycles,
          t.warning_cycle_threshold,
          t.notes,
          t.created_at,
          COALESCE(COUNT(i.id), 0)::int AS asset_count,
          COALESCE(AVG(i.wash_cycle_count), 0)::numeric(10,2) AS avg_wash_cycles
        FROM laundry_item_types t
        LEFT JOIN laundry_items i
          ON i.item_type_id = t.id
         AND i.company_name = t.company_name
         AND i.store_id = $2
        WHERE t.company_name = $1
        GROUP BY
          t.id,
          t.company_name,
          t.code,
          t.name,
          t.category,
          t.fabric_type,
          t.size_label,
          t.unit_price,
          t.max_wash_cycles,
          t.warning_cycle_threshold,
          t.notes,
          t.created_at
        ORDER BY t.name ASC
        `,
        [companyName, storeId]
      );

      return res.json({ ok: true, item_types: r.rows });
    } catch (e) {
      console.error("[laundry/item-types]", e);
      return res.status(500).json({ ok: false, error: "Failed to load item types" });
    }
  });

  router.post("/item-types", async (req, res) => {
    const storeId = normalizeText(req.body?.store_id);
    const name = normalizeText(req.body?.name);
    const code = normalizeText(req.body?.code) || deriveTypeCode(name);
    const category = normalizeText(req.body?.category || "FABRICS").toUpperCase();
    const fabricType = normalizeText(req.body?.fabric_type || category || "FABRICS");
    const sizeLabel = normalizeText(req.body?.size_label);
    const unitPrice = normalizeAmount(req.body?.unit_price, null);
    const maxWashCycles = clampInteger(req.body?.max_wash_cycles, {
      min: 1,
      max: 100000,
      fallback: 200,
    });
    const warningCycleThreshold = clampInteger(
      req.body?.warning_cycle_threshold,
      {
        min: 0,
        max: maxWashCycles,
        fallback: Math.max(maxWashCycles - 20, 0),
      }
    );
    const notes = normalizeText(req.body?.notes);

    if (!storeId || !name) {
      return res.status(400).json({ ok: false, error: "store_id and name required" });
    }
    if (!code) {
      return res.status(400).json({ ok: false, error: "code required" });
    }
    if (!(canManageLaundry(req, storeId) || canUseLaundryScanner(req, storeId))) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      const insertRes = await pool.query(
        `
        INSERT INTO laundry_item_types (
          company_name,
          code,
          name,
          category,
          fabric_type,
          size_label,
          unit_price,
          max_wash_cycles,
          warning_cycle_threshold,
          notes,
          created_by_user_id,
          created_by_email
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        `,
        [
          companyName,
          code,
          name,
          category,
          fabricType || null,
          sizeLabel || null,
          unitPrice,
          maxWashCycles,
          warningCycleThreshold,
          notes || null,
          req.user?.user_id || null,
          normalizeText(req.user?.email) || null,
        ]
      );

      return res.json({ ok: true, item_type: insertRes.rows[0] });
    } catch (e) {
      console.error("[laundry/item-types POST]", e);
      if (String(e?.message || "").includes("duplicate")) {
        return res.status(409).json({ ok: false, error: "Item type code already exists" });
      }
      return res.status(500).json({ ok: false, error: "Failed to create item type" });
    }
  });

  router.get("/items", async (req, res) => {
    const storeId = normalizeText(req.query.store_id);
    const status = normalizeText(req.query.status).toUpperCase();
    const q = normalizeText(req.query.q);
    const limit = clampInteger(req.query.limit, {
      min: 1,
      max: 500,
      fallback: 200,
    });

    if (!storeId) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }
    if (!canViewLaundry(req, storeId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      const values = [companyName, storeId];
      const where = [`i.company_name = $1`, `i.store_id = $2`];

      if (status) {
        values.push(status);
        where.push(`i.status = $${values.length}`);
      }

      if (q) {
        values.push(`%${q}%`);
        const idx = values.length;
        where.push(`
          (
            i.epc ILIKE $${idx}
            OR i.item_name ILIKE $${idx}
            OR COALESCE(i.item_category, '') ILIKE $${idx}
            OR COALESCE(i.fabric_type, '') ILIKE $${idx}
            OR COALESCE(i.size_label, '') ILIKE $${idx}
            OR COALESCE(i.current_location, '') ILIKE $${idx}
            OR COALESCE(i.assigned_to, '') ILIKE $${idx}
          )
        `);
      }

      values.push(limit);
      const limitIndex = values.length;

      const r = await pool.query(
        `
        SELECT
          i.id,
          i.epc,
          i.item_type_id,
          i.item_code,
          i.item_name,
          i.item_category,
          i.fabric_type,
          i.size_label,
          i.unit_price,
          i.status,
          i.current_location,
          i.assigned_to,
          i.wash_cycle_count,
          i.max_wash_cycles,
          i.warning_cycle_threshold,
          i.last_event_at,
          i.created_at,
          GREATEST(i.max_wash_cycles - i.wash_cycle_count, 0)::int AS remaining_cycles,
          CASE
            WHEN i.wash_cycle_count >= i.max_wash_cycles THEN 'EXCEEDED'
            WHEN i.wash_cycle_count >= i.warning_cycle_threshold THEN 'NEAR_LIMIT'
            ELSE 'OK'
          END AS lifecycle_state,
          ROUND(
            CASE
              WHEN i.max_wash_cycles > 0
                THEN (i.wash_cycle_count::numeric / i.max_wash_cycles::numeric) * 100
              ELSE 0
            END,
            2
          ) AS cycle_utilization_pct,
          t.name AS type_name,
          t.code AS type_code
        FROM laundry_items i
        LEFT JOIN laundry_item_types t
          ON t.id = i.item_type_id
        WHERE ${where.join(" AND ")}
        ORDER BY
          CASE
            WHEN i.wash_cycle_count >= i.max_wash_cycles THEN 0
            WHEN i.wash_cycle_count >= i.warning_cycle_threshold THEN 1
            ELSE 2
          END,
          i.last_event_at DESC,
          i.epc ASC
        LIMIT $${limitIndex}
        `,
        values
      );

      return res.json({ ok: true, items: r.rows });
    } catch (e) {
      console.error("[laundry/items]", e);
      return res.status(500).json({ ok: false, error: "Failed to load laundry items" });
    }
  });

  router.post("/items/register", async (req, res) => {
    const storeId = normalizeText(req.body?.store_id);
    const epc = normalizeTag(req.body?.epc);
    const itemTypeId = Number(req.body?.item_type_id);
    const itemName = normalizeText(req.body?.item_name);
    const itemCategory = normalizeText(req.body?.item_category).toUpperCase();
    const fabricType = normalizeText(req.body?.fabric_type);
    const sizeLabel = normalizeText(req.body?.size_label);
    const unitPrice = normalizeAmount(req.body?.unit_price, null);
    const currentLocation = normalizeText(req.body?.current_location);
    const assignedTo = normalizeText(req.body?.assigned_to);
    const notes = normalizeText(req.body?.notes);

    if (!storeId || !epc || !Number.isInteger(itemTypeId) || itemTypeId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "store_id, epc and item_type_id are required",
      });
    }
    if (!canManageLaundry(req, storeId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const client = await pool.connect();
    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      await client.query("BEGIN");

      const typeRes = await client.query(
        `
        SELECT
          id,
          code,
          name,
          category,
          fabric_type,
          size_label,
          unit_price,
          max_wash_cycles,
          warning_cycle_threshold
        FROM laundry_item_types
        WHERE company_name = $1
          AND id = $2
        LIMIT 1
        `,
        [companyName, itemTypeId]
      );

      if (!typeRes.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Item type not found" });
      }

      const typeRow = typeRes.rows[0];
      const resolvedItemName = itemName || typeRow.name;
      const resolvedItemCategory =
        itemCategory || normalizeText(typeRow.category || "FABRICS").toUpperCase();
      const resolvedFabricType =
        fabricType ||
        normalizeText(typeRow.fabric_type || typeRow.category || "FABRICS");
      const resolvedSizeLabel = sizeLabel || normalizeText(typeRow.size_label);
      const typeUnitPrice = normalizeAmount(typeRow.unit_price, null);
      const resolvedUnitPrice =
        unitPrice === null ? typeUnitPrice : normalizeAmount(unitPrice, typeUnitPrice);
      const resolvedMaxWashCycles = clampInteger(req.body?.max_wash_cycles, {
        min: 1,
        max: 100000,
        fallback: clampInteger(typeRow.max_wash_cycles, {
          min: 1,
          max: 100000,
          fallback: 200,
        }),
      });
      const resolvedWarningCycleThreshold = clampInteger(
        req.body?.warning_cycle_threshold,
        {
          min: 0,
          max: resolvedMaxWashCycles,
          fallback: clampInteger(typeRow.warning_cycle_threshold, {
            min: 0,
            max: resolvedMaxWashCycles,
            fallback: Math.max(resolvedMaxWashCycles - 20, 0),
          }),
        }
      );

      const existing = await client.query(
        `
        SELECT id
        FROM laundry_items
        WHERE company_name = $1
          AND epc = $2
        LIMIT 1
        `,
        [companyName, epc]
      );

      if (existing.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "EPC already registered" });
      }

      const itemInsert = await client.query(
        `
        INSERT INTO laundry_items (
          company_name,
          store_id,
          epc,
          item_type_id,
          item_code,
          item_name,
          item_category,
          fabric_type,
          size_label,
          unit_price,
          status,
          current_location,
          assigned_to,
          max_wash_cycles,
          warning_cycle_threshold,
          created_by_user_id,
          created_by_email,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'IN_STOCK', $11, $12, $13, $14, $15, $16, $17::jsonb
        )
        RETURNING *
        `,
        [
          companyName,
          storeId,
          epc,
          typeRow.id,
          typeRow.code,
          resolvedItemName,
          resolvedItemCategory,
          resolvedFabricType || null,
          resolvedSizeLabel || null,
          resolvedUnitPrice,
          currentLocation || null,
          assignedTo || null,
          resolvedMaxWashCycles,
          resolvedWarningCycleThreshold,
          req.user?.user_id || null,
          normalizeText(req.user?.email) || null,
          JSON.stringify({
            notes: notes || null,
          }),
        ]
      );

      const itemRow = itemInsert.rows[0];

      await client.query(
        `
        INSERT INTO laundry_item_events (
          company_name,
          store_id,
          item_id,
          epc,
          event_type,
          from_status,
          to_status,
          cycle_increment,
          wash_cycle_after,
          location_label,
          assigned_to,
          notes,
          actor_user_id,
          actor_email,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, 'REGISTERED', NULL, 'IN_STOCK', 0, 0, $5, $6, $7, $8, $9, $10::jsonb
        )
        `,
        [
          companyName,
          storeId,
          itemRow.id,
          epc,
          currentLocation || null,
          assignedTo || null,
          notes || null,
          req.user?.user_id || null,
          normalizeText(req.user?.email) || null,
          JSON.stringify({
            type_code: typeRow.code,
            type_name: resolvedItemName,
            fabric_type: resolvedFabricType || null,
            size_label: resolvedSizeLabel || null,
            unit_price: resolvedUnitPrice,
          }),
        ]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, item: itemRow });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[laundry/items/register]", e);
      return res.status(500).json({ ok: false, error: "Failed to register laundry item" });
    } finally {
      client.release();
    }
  });

  router.post("/actions", async (req, res) => {
    const storeId = normalizeText(req.body?.store_id);
    const action = normalizeAction(req.body?.action);
    const config = ACTION_CONFIG[action];
    const locationLabel = normalizeText(req.body?.location_label);
    const assignedTo = normalizeText(req.body?.assigned_to);
    const referenceNo = normalizeText(req.body?.reference_no);
    const notes = normalizeText(req.body?.notes);
    const rawEpcs = Array.isArray(req.body?.epcs)
      ? req.body.epcs
      : normalizeText(req.body?.epcs)
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean);
    const epcs = Array.from(new Set(rawEpcs.map(normalizeTag).filter(Boolean)));
    const cycleIncrement = clampInteger(req.body?.cycle_increment, {
      min: 0,
      max: 1000,
      fallback: config?.defaultCycleIncrement || 0,
    });

    if (!storeId || !config || !epcs.length) {
      return res.status(400).json({
        ok: false,
        error: "store_id, action and at least one EPC are required",
      });
    }

    const canRunAction =
      canManageLaundry(req, storeId) || canUseLaundryScanner(req, storeId);
    if (!canRunAction) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const client = await pool.connect();
    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      await client.query("BEGIN");

      const itemsRes = await client.query(
        `
        SELECT *
        FROM laundry_items
        WHERE company_name = $1
          AND store_id = $2
          AND epc = ANY($3::text[])
        ORDER BY epc ASC
        FOR UPDATE
        `,
        [companyName, storeId, epcs]
      );

      const rows = itemsRes.rows || [];
      const foundEpcs = new Set(rows.map((row) => normalizeTag(row.epc)));
      const missingEpcs = epcs.filter((epcValue) => !foundEpcs.has(epcValue));

      if (missingEpcs.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          ok: false,
          error: "Some EPCs are not registered in Laundry",
          missing_epcs: missingEpcs,
        });
      }

      const updatedItems = [];
      for (const row of rows) {
        const nextStatus = config.toStatus || row.status;
        const nextCycleCount = row.wash_cycle_count + cycleIncrement;
        const nextLocation = locationLabel || row.current_location || null;
        const nextAssignedTo =
          action === "checkout" || action === "dispatch"
            ? assignedTo || row.assigned_to || null
            : assignedTo
            ? assignedTo
            : row.assigned_to || null;
        const nextRetiredAt =
          nextStatus === "RETIRED" ? new Date().toISOString() : row.retired_at;

        const updateRes = await client.query(
          `
          UPDATE laundry_items
          SET
            status = $2,
            current_location = $3,
            assigned_to = $4,
            wash_cycle_count = $5,
            retired_at = $6,
            last_event_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [
            row.id,
            nextStatus,
            nextLocation,
            nextAssignedTo,
            nextCycleCount,
            nextRetiredAt,
          ]
        );

        const updatedRow = updateRes.rows[0];
        updatedItems.push(updatedRow);

        await client.query(
          `
          INSERT INTO laundry_item_events (
            company_name,
            store_id,
            item_id,
            epc,
            event_type,
            from_status,
            to_status,
            cycle_increment,
            wash_cycle_after,
            location_label,
            assigned_to,
            reference_no,
            notes,
            actor_user_id,
            actor_email,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
          )
          `,
          [
            companyName,
            storeId,
            row.id,
            row.epc,
            config.eventType,
            row.status,
            nextStatus,
            cycleIncrement,
            nextCycleCount,
            nextLocation,
            nextAssignedTo,
            referenceNo || null,
            notes || null,
            req.user?.user_id || null,
            normalizeText(req.user?.email) || null,
            JSON.stringify({
              action,
            }),
          ]
        );
      }

      await client.query("COMMIT");
      return res.json({
        ok: true,
        action,
        processed: updatedItems.length,
        items: updatedItems,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[laundry/actions]", e);
      return res.status(500).json({ ok: false, error: "Failed to apply laundry action" });
    } finally {
      client.release();
    }
  });

  router.get("/events", async (req, res) => {
    const storeId = normalizeText(req.query.store_id);
    const limit = clampInteger(req.query.limit, {
      min: 1,
      max: 200,
      fallback: 50,
    });

    if (!storeId) {
      return res.status(400).json({ ok: false, error: "store_id required" });
    }
    if (!canViewLaundry(req, storeId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    try {
      const companyName = await requireCompanyScope(req, res, storeId);
      if (!companyName) return;

      const r = await pool.query(
        `
        SELECT
          e.id,
          e.epc,
          e.event_type,
          e.from_status,
          e.to_status,
          e.cycle_increment,
          e.wash_cycle_after,
          e.location_label,
          e.assigned_to,
          e.reference_no,
          e.notes,
          e.actor_email,
          e.created_at,
          i.item_name,
          i.item_category
        FROM laundry_item_events e
        LEFT JOIN laundry_items i
          ON i.id = e.item_id
        WHERE e.company_name = $1
          AND e.store_id = $2
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $3
        `,
        [companyName, storeId, limit]
      );

      return res.json({ ok: true, events: r.rows });
    } catch (e) {
      console.error("[laundry/events]", e);
      return res.status(500).json({ ok: false, error: "Failed to load laundry events" });
    }
  });

  return router;
};
