// src/api/routes/health.js
const { Router } = require("express");
const router = Router();

/**
 * Simple text response; friendly to fetch(...).text()
 * CORS headers are handled globally in app.js
 */
router.get("/", (req, res) => {
  res
    .status(200)
    .type("text")
    .send("ok");
});

module.exports = router;
