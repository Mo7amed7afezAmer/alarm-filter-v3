import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixtureGuard, testFilesOf } from "../../vitest.fixtures";

const root = fileURLToPath(new URL("../../", import.meta.url));

const files = [
  { file: "src/parser/parser.test.ts", content: 'const dir = new URL("../../../../samples/parser", import.meta.url);' },
  { file: "src/hourly/site-master.test.ts", content: 'const original = "tests/fixtures/SiteMaster.xlsx";' },
  { file: "src/notify/notify.test.ts", content: "expect(matchesPrefs(a, b)).toBe(true);" },
];

// P4-T03: fixture-dependent tests fail (not skip) in CI when samples/ or TEST_DATABASE_URL are missing;
// locally they are skipped with a warning.
describe("fixture guard (P4-T03)", () => {
  it("CI without TEST_DATABASE_URL → fails the run", () => {
    expect(() => fixtureGuard({ ci: true, needsDatabase: true, databaseUrl: undefined, missingDirs: [], testFiles: files })).toThrow(
      /TEST_DATABASE_URL/,
    );
    expect(() => fixtureGuard({ ci: true, needsDatabase: true, databaseUrl: "", missingDirs: [], testFiles: files })).toThrow(
      /TEST_DATABASE_URL/,
    );
  });

  it("CI without samples/ → fails the run", () => {
    expect(() =>
      fixtureGuard({ ci: true, needsDatabase: false, databaseUrl: undefined, missingDirs: ["samples"], testFiles: files }),
    ).toThrow(/samples/);
  });

  it("CI with everything present → nothing excluded, no warnings", () => {
    expect(
      fixtureGuard({ ci: true, needsDatabase: true, databaseUrl: "postgresql://x/alarms_test", missingDirs: [], testFiles: files }),
    ).toEqual({ exclude: [], warnings: [] });
  });

  it("locally without TEST_DATABASE_URL → a warning; the DB suites skip themselves", () => {
    const r = fixtureGuard({ ci: false, needsDatabase: true, databaseUrl: undefined, missingDirs: [], testFiles: files });
    expect(r.exclude).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/TEST_DATABASE_URL.*skipped/);
  });

  it("locally without samples/ → skips exactly the files that read samples/, with a warning", () => {
    const r = fixtureGuard({ ci: false, needsDatabase: false, databaseUrl: undefined, missingDirs: ["samples"], testFiles: files });
    expect(r.exclude).toEqual(["src/parser/parser.test.ts"]);
    expect(r.warnings.join("\n")).toMatch(/samples.*skipped/);
  });

  it("locally without tests/fixtures/ → skips the files that read it", () => {
    const r = fixtureGuard({ ci: false, needsDatabase: false, databaseUrl: undefined, missingDirs: ["tests/fixtures"], testFiles: files });
    expect(r.exclude).toEqual(["src/hourly/site-master.test.ts"]);
  });

  it("a package without database tests ignores TEST_DATABASE_URL", () => {
    expect(fixtureGuard({ ci: true, needsDatabase: false, databaseUrl: undefined, missingDirs: [], testFiles: files }).warnings).toEqual(
      [],
    );
  });

  it("follows relative imports: worker tests that use the samples-fed mock Gmail are skipped too", () => {
    const testFiles = testFilesOf(root + "apps/worker");
    const r = fixtureGuard({ ci: false, needsDatabase: false, databaseUrl: undefined, missingDirs: ["samples"], testFiles });
    expect(r.exclude).toContain("src/run.db.test.ts");
    expect(r.exclude).toContain("src/ingest.test.ts");
    expect(r.exclude).not.toContain("src/ticker.test.ts");
  });

  it("the web image copies the guard, because next build typechecks apps/web/vitest.config.ts", () => {
    expect(readFileSync(root + "apps/web/vitest.config.ts", "utf8")).toContain("../../vitest.fixtures");
    expect(readFileSync(root + "apps/web/Dockerfile", "utf8")).toMatch(/^COPY vitest\.fixtures\.ts \.\/$/m);
  });

  // The real thing: packages/db's suite with CI=true and no TEST_DATABASE_URL must exit non-zero.
  const runDbTests = (env: Record<string, string>) =>
    spawnSync("npx", ["vitest", "run", "src/seed.test.ts"], {
      cwd: root + "packages/db",
      env: { ...process.env, TEST_DATABASE_URL: "", ...env },
      encoding: "utf8",
      shell: true,
      timeout: 120_000,
    });

  it("packages/db with CI=true and no TEST_DATABASE_URL exits non-zero", () => {
    const r = runDbTests({ CI: "true" });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/TEST_DATABASE_URL/);
  });

  it("packages/db locally without TEST_DATABASE_URL passes with a skip warning", () => {
    const r = runDbTests({ CI: "" });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/TEST_DATABASE_URL.*skipped/);
  });
});
