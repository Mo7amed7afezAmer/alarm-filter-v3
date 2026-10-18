import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { guardFixtures } from "../../vitest.fixtures";

const root = fileURLToPath(new URL("../..", import.meta.url));
// P4-T03: core reads samples/ and tests/fixtures/ only; fail in CI when they are missing, skip locally.
const skipped = guardFixtures({ root, packageDir: fileURLToPath(new URL(".", import.meta.url)), needsDatabase: false, env: process.env });

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...skipped],
  },
});
