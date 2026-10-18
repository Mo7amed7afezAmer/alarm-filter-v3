import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { guardFixtures } from "../../vitest.fixtures";

const root = fileURLToPath(new URL("../..", import.meta.url));
// P4-T03: fail in CI when fixtures are missing; skip with a warning locally.
const skipped = guardFixtures({ root, packageDir: fileURLToPath(new URL(".", import.meta.url)), needsDatabase: false, env: process.env });

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...skipped],
    fileParallelism: false,
    testTimeout: 600_000,
  },
});
