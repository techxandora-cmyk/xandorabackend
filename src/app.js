// src/app.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// --- CORS first, before routes ---
app.use(
  cors({
    origin: true,          // reflect the Origin header (http://localhost:5173)
    credentials: true,
  })
);

// --- Common middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Helper to mount routes if file exists
function tryMount(routePath, relFile) {
  try {
    const file = path.join(__dirname, relFile);
    const router = require(file);
    app.use(routePath, router);
    console.log(`Mounted ${routePath} -> ${relFile}`);
  } catch (e) {
    // don't crash if a route file is missing
  }
}

// --- Routes ---
tryMount("/health", "./api/routes/health");
tryMount("/api/v1/scan", "./api/routes/scan");
tryMount("/api/v1/pos", "./api/routes/pos");
tryMount("/api/v1/devices", "./api/routes/devices");
tryMount("/api/v1/security", "./api/routes/security");
tryMount("/api/v1/metrics", "./api/routes/metrics");
tryMount("/api/v1/events", "./api/routes/events");

// Fallback 404 (text, not HTML) so fetch() .text() still works
app.use((req, res) => {
  res.status(404).type("text").send("Not Found");
});

module.exports = app;
