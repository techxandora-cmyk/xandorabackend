import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const dashboardRoot = process.cwd();
const repoRoot = path.resolve(dashboardRoot, "..");
const appUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const apiUrl = process.env.E2E_API_URL || "http://127.0.0.1:3000/api/v1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node backend/server.js",
      cwd: repoRoot,
      url: "http://127.0.0.1:3000/api/health/live",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        PORT: process.env.PORT || "3000",
        FRONTEND_ORIGIN: appUrl,
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      cwd: dashboardRoot,
      url: `${appUrl}/login`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_BASE_URL: apiUrl,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
