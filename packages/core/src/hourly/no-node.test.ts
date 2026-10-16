import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G-T13 / CLAUDE.md: packages/core/hourly runs in the browser and React Native — no Node imports.
// (`pnpm --filter @alarm/core typecheck` also compiles it with lib ["dom"] and no Node types.)
const dir = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-helpers.ts");

describe("packages/core/src/hourly", () => {
  it.each(sources)("%s imports nothing from Node", (file) => {
    const text = readFileSync(dir + file, "utf8");
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    const node = ["fs", "path", "os", "crypto", "child_process", "stream", "buffer", "url", "util", "module"];
    expect(imports.filter((i) => i.startsWith("node:") || node.includes(i))).toEqual([]);
    expect(text).not.toMatch(/\b(process\.|Buffer\.|__dirname|require\()/);
  });
});
