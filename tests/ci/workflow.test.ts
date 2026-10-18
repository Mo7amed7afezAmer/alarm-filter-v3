import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  "runs-on": string;
  "timeout-minutes"?: number;
  services?: Record<string, { image: string; env?: Record<string, string>; ports?: string[] }>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: { push?: { branches: string[] }; pull_request?: { branches: string[] } };
  jobs: Record<string, Job>;
}

const file = fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url));
const text = readFileSync(file, "utf8");
const wf = parse(text) as Workflow;
const runs = (job: Job) => job.steps.map((s) => s.run ?? "").join("\n");
const allRuns = Object.values(wf.jobs).map(runs).join("\n");

// P4-T04: GitHub Actions on push / pull_request to main: lint, typecheck, unit, integration against a
// postgres:16 service (alarms_test), Playwright smoke, Docker build; < 15 min; no real Gmail credentials.
describe("CI workflow (P4-T04)", () => {
  it("runs on push and pull_request to main", () => {
    expect(wf.on.push?.branches).toEqual(["main"]);
    expect(wf.on.pull_request?.branches).toEqual(["main"]);
  });

  it("runs lint and typecheck", () => {
    expect(allRuns).toMatch(/pnpm lint/);
    expect(allRuns).toMatch(/pnpm typecheck/);
  });

  it("runs the unit and integration tests against a postgres:16 service with database alarms_test, CI=true", () => {
    const job = Object.values(wf.jobs).find((j) => /pnpm test|vitest/.test(runs(j)) && j.services?.postgres)!;
    expect(job).toBeDefined();
    expect(job.services!.postgres!.image).toBe("postgres:16");
    expect(job.services!.postgres!.env?.POSTGRES_DB).toBe("alarms_test");
    expect(job.env?.TEST_DATABASE_URL).toMatch(/\/alarms_test$/);
    expect(job.env?.CI ?? "true").toBe("true");
    const names = job.steps.map((s) => s.name ?? "").join("\n");
    expect(names).toMatch(/Unit/);
    expect(names).toMatch(/Integration/);
  });

  it("runs the Playwright smoke tests against alarms_test", () => {
    const job = Object.values(wf.jobs).find((j) => /pnpm e2e/.test(runs(j)))!;
    expect(job).toBeDefined();
    expect(job.services?.postgres?.image).toBe("postgres:16");
    expect(job.env?.TEST_DATABASE_URL).toMatch(/\/alarms_test$/);
    expect(runs(job)).toMatch(/playwright install/);
  });

  it("builds the Docker images", () => {
    expect(allRuns).toMatch(/docker compose[^\n]* build/);
  });

  it("keeps every job under 15 minutes", () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect(job["timeout-minutes"], name).toBeDefined();
      expect(job["timeout-minutes"]!, name).toBeLessThanOrEqual(15);
    }
  });

  it("needs no real Gmail credentials or repository secrets", () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/credentials\.json|token\.json|GOOGLE_(CREDENTIALS|TOKEN)_PATH|gmail:auth/);
  });

  it("uses Node 20 and the pinned pnpm (packageManager)", () => {
    for (const job of Object.values(wf.jobs)) {
      const node = job.steps.find((s) => s.uses?.startsWith("actions/setup-node"));
      if (node) expect(String(node.with?.["node-version"])).toBe("20");
    }
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
      packageManager: string;
    };
    expect(pkg.packageManager).toBe("pnpm@9.15.9");
  });
});
