import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { guardFixtures } from "../../vitest.fixtures";

const root = fileURLToPath(new URL("../..", import.meta.url));
const env = loadEnv("", root, "");
// P4-T03: fail in CI when fixtures are missing; skip with a warning locally.
const skipped = guardFixtures({ root, packageDir: fileURLToPath(new URL(".", import.meta.url)), needsDatabase: true, env });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig keeps JSX for Next ("preserve"); tests that import pages compile it with the automatic runtime.
  esbuild: { jsx: "automatic" },
  test: {
    // Route and repository code reads DATABASE_URL; tests point it at alarms_test (NFR-41).
    env: { ...env, DATABASE_URL: env.TEST_DATABASE_URL ?? "", NEXTAUTH_SECRET: "test-secret-for-vitest-only" },
    // Playwright specs (e2e/) run with `pnpm e2e`, not Vitest.
    exclude: ["**/node_modules/**", "e2e/**", ".next/**", ".next-e2e/**", ...skipped],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
