function validationLabel(status) {
  switch (String(status || "").toUpperCase()) {
    case "MATCHED":
      return "Matched";
    case "UNKNOWN_EPC":
      return "Unknown EPC";
    case "DUPLICATE":
      return "Duplicate";
    case "ALREADY_BILLED":
      return "Already billed";
    default:
      return "Validation failed";
  }
}

async function loadCatalogItem(db, storeId, epc) {
  const result = await db.query(
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
      price_lkr
    FROM catalog_items
    WHERE store_id = $1
      AND epc = $2
    LIMIT 1
    `,
    [storeId, epc]
  );

  return result.rows[0] || null;
}

async function getNetSoldCount(db, storeId, epc) {
  const result = await db.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN UPPER(COALESCE(pt.metadata->>'txn_type', '')) IN ('RETURN', 'REFUND')
          OR COALESCE(pt.total_amount, 0) < 0
          OR COALESCE(pt.total_items, 0) < 0
          THEN -1
        ELSE 1
      END
    ), 0)::int AS net_sold
    FROM pos_transaction_items pti
    JOIN pos_transactions pt ON pt.id = pti.pos_txn_id
    WHERE pti.epc = $1
      AND pt.store_id = $2
    `,
    [epc, storeId]
  );

  return Number(result.rows[0]?.net_sold || 0);
}

async function validateRetailScan(db, input = {}) {
  const storeId = String(input.store_id || "").trim();
  const epc = String(input.epc || "").trim().toUpperCase();
  const duplicateRead = Number(input.duplicate_read_count || 0) > 0;

  if (!storeId || !epc) {
    return {
      validation_status: "VALIDATION_FAILED",
      validation_label: validationLabel("VALIDATION_FAILED"),
      validation_message: "store_id and epc are required",
      catalog_item: null,
      already_billed: false,
    };
  }

  try {
    const catalogItem = await loadCatalogItem(db, storeId, epc);
    if (!catalogItem) {
      return {
        validation_status: "UNKNOWN_EPC",
        validation_label: validationLabel("UNKNOWN_EPC"),
        validation_message: "No catalog item is mapped to this EPC in the selected store.",
        catalog_item: null,
        already_billed: false,
      };
    }

    const netSold = await getNetSoldCount(db, storeId, epc);
    if (netSold > 0) {
      return {
        validation_status: "ALREADY_BILLED",
        validation_label: validationLabel("ALREADY_BILLED"),
        validation_message: "This EPC has already been billed in POS history.",
        catalog_item: catalogItem,
        already_billed: true,
      };
    }

    if (duplicateRead) {
      return {
        validation_status: "DUPLICATE",
        validation_label: validationLabel("DUPLICATE"),
        validation_message: "This EPC is already in the active billing session.",
        catalog_item: catalogItem,
        already_billed: false,
      };
    }

    return {
      validation_status: "MATCHED",
      validation_label: validationLabel("MATCHED"),
      validation_message: "Item matched to catalog and is ready for POS validation.",
      catalog_item: catalogItem,
      already_billed: false,
    };
  } catch (err) {
    return {
      validation_status: "VALIDATION_FAILED",
      validation_label: validationLabel("VALIDATION_FAILED"),
      validation_message: err?.message || "Validation could not be completed.",
      catalog_item: null,
      already_billed: false,
    };
  }
}

module.exports = {
  getNetSoldCount,
  loadCatalogItem,
  validateRetailScan,
  validationLabel,
};
