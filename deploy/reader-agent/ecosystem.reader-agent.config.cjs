/*
 * Xandora SaaS reader agent profile.
 *
 * Install this on the customer's always-on store server, set XANDORA_BASE_URL
 * and STORE_TOKEN in the environment, then start it with PM2. The launcher
 * fetches all active readers registered for that store token and starts one
 * child bridge per reader.
 */

module.exports = {
  apps: [
    {
      name: "xandora-reader-agent",
      script: "./xandora-llrp-bridge.js",
      cwd: __dirname + "/../..",
      env: {
        NODE_ENV: "production",
        XANDORA_BASE_URL:
          process.env.XANDORA_BASE_URL || "https://xandorabackend-44dt.onrender.com",
        STORE_TOKEN: process.env.STORE_TOKEN || "",
        READER_PORT: process.env.READER_PORT || "5084",
        SCAN_PATH: "/api/v1/scans/batch",
        EVENTS_PATH: "/api/v1/events/ingest",
        FLUSH_INTERVAL_MS: "1000",
        RECONNECT_DELAY_MS: "5000",
        GET_REPORT_INTERVAL_MS: "1000",
        NO_REPORT_SWITCH_MS: "12000",
        EXIT_AFTER_MS: "15000",
        DWELL_HEARTBEAT_MS: "30000",
      },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      min_uptime: "10s",
    },
  ],
};
