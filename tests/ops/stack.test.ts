import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G-T16 live checks against a running production stack (`docker compose up -d` from this
// repository). Run with: OPS_BASE_URL=https://localhost pnpm ops:test
// OPS_RESTORE=1 also runs the backup → restore check, which overwrites the stack's database with
// its own fresh backup (use it on a new deployment, not on live data).
const base = process.env.OPS_BASE_URL;
const project = process.env.OPS_PROJECT ?? "alarm-platform";
const pgUser = process.env.POSTGRES_USER ?? "alarms";
const pgDb = process.env.POSTGRES_DB ?? "alarms";
const root = fileURLToPath(new URL("../../", import.meta.url));
// Caddy `tls internal` is self-signed until the root CA is trusted (D-06).
if (base) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", "-p", project, "--project-directory", root, ...args], { cwd: root, encoding: "utf8" }).trim();
const sql = (q: string) => compose("exec", "-T", "db", "psql", "-U", pgUser, "-d", pgDb, "-tAc", q);
const alarms = () => Number(sql("SELECT count(*) FROM alarms"));

describe.skipIf(!base)("production stack", () => {
  it("serves /api/health over HTTPS through the proxy (FR-70, D-06)", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
  });

  it("the 11th login attempt within a minute from one IP gets 429 (D-08)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${base}/api/auth/callback/credentials`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: `ops-${i}@noc.test`, password: "wrong-password" }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });

  it("web and worker run as the non-root user node (NFR-26)", () => {
    expect(compose("exec", "-T", "web", "id", "-un")).toBe("node");
    expect(compose("exec", "-T", "worker", "id", "-un")).toBe("node");
  });

  it("the backup service deletes dumps older than 14 days (D-07)", () => {
    compose("exec", "-T", "backup", "touch", "-d", "15 days ago", "/backups/alarms-old-test.dump");
    compose("exec", "-T", "backup", "backup.sh", "once");
    const files = readdirSync(root + "backups");
    expect(files).not.toContain("alarms-old-test.dump");
    expect(files.some((f) => /^alarms-\d{8}T\d{6}Z\.dump$/.test(f))).toBe(true);
  });

  it.skipIf(process.env.OPS_RESTORE !== "1")("backup → restore reproduces the alarms row count (D-07)", () => {
    const before = alarms();
    compose("exec", "-T", "backup", "backup.sh", "once");
    const latest = readdirSync(root + "backups")
      .filter((f) => f.endsWith(".dump"))
      .sort((a, b) => statSync(root + "backups/" + b).mtimeMs - statSync(root + "backups/" + a).mtimeMs)[0]!;
    sql(
      `INSERT INTO alarms ("alarmKey","alarmName",site,category,"alarmTime",status) VALUES ('ops||restore','OPS RESTORE TEST','OPS_RESTORE','OTHER',now(),'ACTIVE')`,
    );
    expect(alarms()).toBe(before + 1);
    execFileSync("sh", [root + "scripts/restore.sh", "--yes", root + "backups/" + latest], {
      cwd: root,
      // MSYS_NO_PATHCONV: Git Bash on Windows would rewrite `db:/tmp/…` into a Windows path.
      env: { ...process.env, COMPOSE_PROJECT_NAME: project, MSYS_NO_PATHCONV: "1" },
      stdio: "pipe",
    });
    expect(alarms()).toBe(before);
  });
});
