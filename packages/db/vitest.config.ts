import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { guardFixtures } from "../../vitest.fixtures";

const root = fileURLToPath(new URL("../..", import.meta.url));
const env = loadEnv("", root, "");
// P4-T03: fail in CI when fixtures are missing; skip with a warning locally.
const skipped = guardFixtures({ root, packageDir: fileURLToPath(new URL(".", import.meta.url)), needsDatabase: true, env });

export default defineConfig({
  test: {
    env,
    exclude: [...configDefaults.exclude, ...skipped],
    // Tests share one database (alarms_test); run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
