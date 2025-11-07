// src/services/db.js
// Bridge file for legacy imports — routes still require this.
// It simply re-exports the main DB pool.

const db = require("../db.js");

module.exports = db;
