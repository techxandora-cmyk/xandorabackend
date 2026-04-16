const isDirectRun = require.main === module;

if (!isDirectRun) {
  process.env.CLOUD_FUNCTION = "true";
}

const { app } = require("../backend/server");

if (isDirectRun) {
  module.exports = { app };
} else {
  const functions = require("firebase-functions/v1");

  exports.api = functions
    .runWith({ timeoutSeconds: 540, memory: "512MB" })
    .https.onRequest(app);
}
