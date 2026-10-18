import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G-T16 static checks of the production and development compose files and the Caddyfile
// (NFR-16, NFR-21, NFR-26, NFR-30, NFR-32, NFR-33, D-06, D-07, D-08). `docker compose config`
// resolves the files exactly as `up` would; the live checks are in stack.test.ts.
const root = fileURLToPath(new URL("../../", import.meta.url));

interface Service {
  image?: string;
  build?: unknown;
  command?: string[] | string;
  ports?: { published?: string; host_ip?: string }[];
  volumes?: { type: string; source?: string; target: string; read_only?: boolean }[];
  healthcheck?: { test: string[]; interval?: string };
  restart?: string;
  user?: string;
  environment?: Record<string, string | null>;
  depends_on?: Record<string, { condition: string }>;
}

function hasDocker(): boolean {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const docker = hasDocker();
if (!docker) console.warn("docker compose not found: compose checks skipped");

function config(...files: string[]): Record<string, Service> {
  // .env.example instead of .env; placeholders for the variables compose requires.
  const args = ["compose", "--env-file", root + ".env.example", "--project-directory", root];
  const env = { ...process.env, POSTGRES_PASSWORD: "x", NEXTAUTH_SECRET: "x" };
  const out = execFileSync("docker", [...args, ...files.flatMap((f) => ["-f", root + f]), "config", "--format", "json"], {
    env,
    encoding: "utf8",
  });
  return (JSON.parse(out) as { services: Record<string, Service> }).services;
}

describe.skipIf(!docker)("docker-compose.yml (production)", () => {
  const s = docker ? config("docker-compose.yml") : {};

  it("defines db, migrate, worker, web, proxy and backup", () => {
    expect(Object.keys(s).sort()).toEqual(["backup", "db", "migrate", "proxy", "web", "worker"]);
  });

  it("only the proxy publishes ports: 80 and 443 (NFR-26, D-06)", () => {
    const publishing = Object.entries(s)
      .filter(([, v]) => v.ports?.length)
      .map(([k]) => k);
    expect(publishing).toEqual(["proxy"]);
    expect(s.proxy!.ports!.map((p) => p.published).sort()).toEqual(["443", "80"]);
  });

  it("web: healthcheck /api/health every 30 s (NFR-33), OAuth files read-only (NFR-21), restarts unless stopped", () => {
    const web = s.web!;
    expect(web.healthcheck!.test.join(" ")).toContain("/api/health");
    expect(web.healthcheck!.interval).toBe("30s");
    const oauth = web.volumes!.filter((v) => v.target.startsWith("/run/gmail/"));
    expect(oauth.map((v) => v.target).sort()).toEqual(["/run/gmail/credentials.json", "/run/gmail/token.json"]);
    expect(oauth.every((v) => v.read_only)).toBe(true);
    expect(web.restart).toBe("unless-stopped");
    expect(web.depends_on?.migrate?.condition).toBe("service_completed_successfully");
  });

  it("web gets every variable the web app reads", () => {
    const env = s.web!.environment!;
    for (const name of [
      "DATABASE_URL",
      "NEXTAUTH_SECRET",
      "NEXTAUTH_URL",
      "ALARM_TZ",
      "ALERT_HOURS",
      "GMAIL_LABELS",
      "GOOGLE_CREDENTIALS_PATH",
      "GOOGLE_TOKEN_PATH",
      "HOURLY_GMAIL_LABEL",
      "HOURLY_MAX_RAR_MB",
      "HOURLY_MAX_EXTRACT_MB",
      "WORKER_STALE_SEC",
    ]) {
      expect(env, name).toHaveProperty(name);
    }
  });

  it("db, worker, web, proxy and backup restart unless stopped; migrate runs once (NFR-16)", () => {
    for (const name of ["db", "worker", "web", "proxy", "backup"]) expect(s[name]!.restart, name).toBe("unless-stopped");
    expect(s.migrate!.restart).toBe("no");
  });

  it("worker: OAuth files read-only (NFR-21), /health every 30 s (NFR-32)", () => {
    const oauth = s.worker!.volumes!.filter((v) => v.target.startsWith("/run/gmail/"));
    expect(oauth).toHaveLength(2);
    expect(oauth.every((v) => v.read_only)).toBe(true);
    expect(s.worker!.healthcheck!.test.join(" ")).toContain("/health");
    expect(s.worker!.healthcheck!.interval).toBe("30s");
  });

  it("db: pg_isready healthcheck every 5 s (NFR-32), container TZ=UTC (NFR-29)", () => {
    expect(s.db!.healthcheck!.test.join(" ")).toContain("pg_isready");
    expect(s.db!.healthcheck!.interval).toBe("5s");
    expect(s.db!.environment!.TZ).toBe("UTC");
  });

  it("Postgres data in the named volume pgdata (NFR-30)", () => {
    expect(s.db!.volumes!.find((v) => v.target === "/var/lib/postgresql/data")).toMatchObject({ type: "volume", source: "pgdata" });
  });

  it("backup: daily pg_dump -Fc into ./backups, 14-day retention (D-07)", () => {
    const b = s.backup!;
    expect(b.volumes!.find((v) => v.target === "/backups")).toMatchObject({ type: "bind" });
    expect(b.volumes!.find((v) => v.target === "/backups")!.source!.replace(/\\/g, "/")).toMatch(/\/backups$/);
    expect(b.environment!.BACKUP_KEEP_DAYS).toBe("14");
    expect(b.depends_on?.db?.condition).toBe("service_healthy");
  });
});

describe.skipIf(!docker)("docker-compose.dev.yml (development)", () => {
  const s = docker ? config("docker-compose.yml", "docker-compose.dev.yml") : {};

  it("web runs `next dev` and worker `tsx watch` on bind-mounted sources", () => {
    expect([s.web!.command].flat().join(" ")).toContain("next dev");
    expect([s.worker!.command].flat().join(" ")).toContain("tsx watch");
    for (const name of ["web", "worker"]) {
      expect(
        s[name]!.volumes!.some((v) => v.type === "bind" && v.target === "/app"),
        name,
      ).toBe(true);
    }
  });

  it("publishes db, web and worker health on 127.0.0.1 only (NFR-26)", () => {
    for (const name of ["db", "web", "worker"]) {
      expect(s[name]!.ports?.length, name).toBeGreaterThan(0);
      expect(
        s[name]!.ports!.every((p) => p.host_ip === "127.0.0.1"),
        name,
      ).toBe(true);
    }
  });
});

describe("images and ignore files", () => {
  const read = (f: string) => readFileSync(root + f, "utf8");
  const lines = (f: string) =>
    read(f)
      .split(/\r?\n/)
      .map((l) => l.trim());

  it("web image: node:20-bookworm-slim, Debian non-free unrar, standalone Next.js, runs as node (NFR-33, NFR-26)", () => {
    const dockerfile = read("apps/web/Dockerfile");
    expect(dockerfile.match(/^FROM .+$/gm)!.every((l) => l.startsWith("FROM node:20-bookworm-slim"))).toBe(true);
    expect(dockerfile).toMatch(/non-free/);
    expect(dockerfile).toMatch(/apt-get install[^\n]*\bunrar\b/);
    expect(dockerfile).toMatch(/BUILD_STANDALONE=1/);
    expect(dockerfile).toMatch(/\.next\/standalone/);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(read("apps/worker/Dockerfile")).toMatch(/^USER node$/m);
  });

  it("image builds survive a flaky registry: pnpm retries, cached pnpm store and Prisma engines", () => {
    for (const f of ["apps/web/Dockerfile", "apps/worker/Dockerfile", "packages/db/Dockerfile"]) {
      const dockerfile = read(f);
      expect(dockerfile, f).toMatch(/npm_config_fetch_retries=\d+/);
      expect(dockerfile, f).toMatch(/RUN --mount=type=cache,id=pnpm-store,target=\/pnpm\/store[^\n]*pnpm install --frozen-lockfile/);
      expect(dockerfile, f).toMatch(/--mount=type=cache,id=prisma-engines,target=\/root\/\.cache\/prisma/);
    }
  });

  it("secrets stay out of git and images (NFR-22)", () => {
    for (const f of [".gitignore", ".dockerignore"]) {
      const l = lines(f);
      for (const entry of [".env", ".env.*"]) expect(l, `${f} ${entry}`).toContain(entry);
      expect(
        l.some((x) => /^secrets\/?$/.test(x)),
        `${f} secrets`,
      ).toBe(true);
    }
    const docker = lines(".dockerignore");
    for (const entry of ["credentials.json", "token.json", "samples", "tests", "backups"]) expect(docker, entry).toContain(entry);
    expect(lines(".gitignore")).toContain("backups/");
  });
});

describe("proxy/Caddyfile (D-06, D-08)", () => {
  const caddyfile = readFileSync(root + "proxy/Caddyfile", "utf8");

  it("serves the site with tls internal and proxies to web:3000", () => {
    expect(caddyfile).toMatch(/tls internal/);
    expect(caddyfile).toMatch(/reverse_proxy web:3000/);
  });

  it("limits POST /api/auth/callback/credentials to 10 per minute per client IP", () => {
    expect(caddyfile).toMatch(/rate_limit/);
    expect(caddyfile).toMatch(/path \/api\/auth\/callback\/credentials/);
    expect(caddyfile).toMatch(/method POST/);
    expect(caddyfile).toMatch(/key\s+\{remote_host\}/);
    expect(caddyfile).toMatch(/events\s+10\b/);
    expect(caddyfile).toMatch(/window\s+1m\b/);
  });

  it("the mobile sign-in POST /api/v1/auth/login shares the same 10/min/IP zone (decision P7 mobile login)", () => {
    expect(caddyfile).toMatch(/path \/api\/auth\/callback\/credentials \/api\/v1\/auth\/login/);
  });

  it("the proxy image pins caddy-ratelimit", () => {
    expect(readFileSync(root + "proxy/Dockerfile", "utf8")).toMatch(/github\.com\/mholt\/caddy-ratelimit@[0-9a-f]{7,}|caddy-ratelimit@v\d/);
  });
});
