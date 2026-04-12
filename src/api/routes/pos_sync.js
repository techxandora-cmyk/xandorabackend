// src/api/routes/pos_sync.js
const express = require("express");
const router = express.Router();

const { insertSales } = require("../../services/pos");
// events.js is in the same routes folder, so use ./events
const { pushEvent } = require("./events");

// POST /api/v1/pos/sync
// body: { sales: [{ ext_id, store_id, items_count, amount, ts }, ...] }
router.post("/sync", async (req, res) => {
  const sales = req.body?.sales;
  if (!Array.isArray(sales)) {
    return res.status(400).json({ error: "sales array required" });
  }

  try {
    const { inserted } = await insertSales(sales);

    // 🔔 Realtime push only when something was inserted
    if (inserted > 0) {
      pushEvent("pos_confirmed", {
        count: inserted,
        at: new Date().toISOString(),
      });
    }

    return res.json({ ok: true, inserted });
  } catch (err) {
    console.error("[pos/sync] failed", err);
    return res.status(500).json({ error: "internal" });
  }
});

module.exports = router;
