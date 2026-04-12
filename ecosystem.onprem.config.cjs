/*
 * On-prem process profile for a single customer site (no domain required).
 * Runs API, worker, and dashboard on one machine.
 */

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

module.exports = {
  apps: [
    {
      name: "zyro-api",
      script: "./backend/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: "zyro-worker",
      script: "./backend/worker.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: "zyro-dashboard",
      script: npmCmd,
      args: "--prefix rfid-dashboard run start -- --port 5173 --strictPort",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      restart_delay: 2000,
    },
  ],
};
