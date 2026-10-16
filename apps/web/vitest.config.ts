import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));
const env = loadEnv("", root, "");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // Route and repository code reads DATABASE_URL; tests point it at alarms_test (NFR-41).
    env: { ...env, DATABASE_URL: env.TEST_DATABASE_URL ?? "", NEXTAUTH_SECRET: "test-secret-for-vitest-only" },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
