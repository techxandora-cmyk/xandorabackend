process.env.CLOUD_FUNCTION = "true";

const functions = require("firebase-functions");
const { app } = require("../backend/server");

exports.api = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onRequest(app);
