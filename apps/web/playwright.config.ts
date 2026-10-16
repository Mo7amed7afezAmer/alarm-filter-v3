import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// NFR-42: Playwright smoke tests against `next dev` on :3200, using alarms_test (NFR-41).
const root = fileURLToPath(new URL("../..", import.meta.url));
const env = loadEnv("", root, "");
const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;

if (!env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for the e2e tests");
process.env.TEST_DATABASE_URL = env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      ...env,
      DATABASE_URL: env.TEST_DATABASE_URL,
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: env.NEXTAUTH_SECRET || "e2e-secret",
      GMAIL_LABELS: "DN/Kafr ElDawar",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
