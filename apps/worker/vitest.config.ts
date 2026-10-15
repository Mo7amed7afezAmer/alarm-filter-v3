import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    env: loadEnv("", root, ""),
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
