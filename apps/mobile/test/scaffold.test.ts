import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOURLY_SHEETS } from "@alarm/core";
import { describe, expect, it } from "vitest";

const app = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());
}

// P7-T01: apps/mobile is an Expo app in the pnpm workspace that bundles packages/core unchanged.
describe("apps/mobile scaffold (P7-T01)", () => {
  it("resolves @alarm/core from the app", () => {
    expect(HOURLY_SHEETS).toContain("5G_Down");
  });

  it("Metro bundles the app for Android and iOS, including @alarm/core", () => {
    const out = mkdtempSync(join(tmpdir(), "mobile-export-"));
    try {
      const r = spawnSync("npx", ["expo", "export", "--platform", "android", "--platform", "ios", "--output-dir", out, "--no-minify"], {
        cwd: app,
        env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
        encoding: "utf8",
        shell: true,
        timeout: 600_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const bundles = filesUnder(out).filter((f) => /\.(hbc|js)$/.test(f) && /_expo[\\/]static[\\/]js/.test(f));
      expect(bundles.map((f) => (f.includes("android") ? "android" : f.includes("ios") ? "ios" : "?")).sort()).toEqual(["android", "ios"]);
      // A string only packages/core contains, to prove it is in the bundle.
      for (const b of bundles) expect(readFileSync(b, "latin1")).toContain("Environmental");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("`pnpm --filter mobile start` brings up Metro", async () => {
    const port = 8097;
    const child = spawn("pnpm", ["--filter", "mobile", "start", "--port", String(port)], {
      cwd: join(app, "../.."),
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
      shell: true,
    });
    try {
      let status = "";
      for (let i = 0; i < 180 && !status.includes("packager-status:running"); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        status = await fetch(`http://localhost:${port}/status`).then(
          (r) => r.text(),
          () => "",
        );
      }
      expect(status).toContain("packager-status:running");
    } finally {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    }
  });
});
