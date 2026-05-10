/*
 * PM2 process file for running multiple RFID readers from one server.
 * Edit READER_HOST / DEVICE_ID / STORE_ID per reader.
 */

const sharedEnv = {
  NODE_ENV: "production",
  SCAN_API_KEY: "CHANGE_ME",
  XANDORA_BASE_URL: "",
  XANDORA_HOST: "127.0.0.1",
  XANDORA_PORT: "3000",
  READER_PORT: "5084",
  SCAN_PATH: "/api/v1/scans/batch",
  EVENTS_PATH: "/api/v1/events/ingest",
  FLUSH_INTERVAL_MS: "1000",
  RECONNECT_DELAY_MS: "3000",
  GET_REPORT_INTERVAL_MS: "1000",
  NO_REPORT_SWITCH_MS: "12000",
  EXIT_AFTER_MS: "15000",
  DWELL_HEARTBEAT_MS: "30000",
};

module.exports = {
  apps: [
    {
      name: "xandora-reader-store001-pos",
      script: "./xandora-llrp-bridge.js",
      cwd: __dirname,
      env: {
        ...sharedEnv,
        READER_HOST: "192.168.100.50",
        DEVICE_ID: "STORE001_POS_01",
        STORE_ID: "STORE_001",
        ZONE_ID: "pos",
      },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: "xandora-reader-store001-exit",
      script: "./xandora-llrp-bridge.js",
      cwd: __dirname,
      env: {
        ...sharedEnv,
        READER_HOST: "192.168.100.51",
        DEVICE_ID: "STORE001_EXIT_01",
        STORE_ID: "STORE_001",
        ZONE_ID: "exit",
      },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: "xandora-reader-store001-fitting",
      script: "./xandora-llrp-bridge.js",
      cwd: __dirname,
      env: {
        ...sharedEnv,
        READER_HOST: "192.168.100.52",
        DEVICE_ID: "STORE001_CHANGING_01",
        STORE_ID: "STORE_001",
        ZONE_ID: "changing_room",
      },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: "xandora-reader-store001-entrance",
      script: "./xandora-llrp-bridge.js",
      cwd: __dirname,
      env: {
        ...sharedEnv,
        READER_HOST: "192.168.100.53",
        DEVICE_ID: "STORE001_ENTRANCE_01",
        STORE_ID: "STORE_001",
        ZONE_ID: "entrance",
      },
      autorestart: true,
      restart_delay: 2000,
    },
  ],
};
