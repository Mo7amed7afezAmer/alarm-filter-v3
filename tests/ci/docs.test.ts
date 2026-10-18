import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f: string) => readFileSync(join(root, f), "utf8");

/** Source files whose environment reads count (apps, packages, root tooling), without build output. */
function sources(): string[] {
  const out: string[] = [];
  for (const dir of ["apps", "packages"]) {
    for (const f of readdirSync(join(root, dir), { recursive: true }) as string[]) {
      const p = f.replace(/\\/g, "/");
      if (/(^|\/)(node_modules|\.next[^/]*|dist|\.e2e-hourly|test-results|playwright-report)\//.test(p)) continue;
      if (/\.(ts|tsx|mjs|cjs)$/.test(p)) out.push(`${dir}/${p}`);
    }
  }
  return [
    ...out,
    "vitest.fixtures.ts",
    ...readdirSync(join(root, "tests"), { recursive: true })
      .map((f) => `tests/${String(f).replace(/\\/g, "/")}`)
      .filter((f) => f.endsWith(".ts")),
  ];
}

/** Every environment variable the code, compose files, Caddyfile and scripts read. */
function envReadByCode(): Set<string> {
  const names = new Set<string>();
  const add = (re: RegExp, text: string) => {
    for (const m of text.matchAll(re)) names.add(m[1]!);
  };
  for (const f of sources()) {
    const t = read(f);
    add(/process\.env\.([A-Z][A-Z0-9_]+)/g, t);
    add(/\benv\.([A-Z][A-Z0-9_]+)/g, t);
    add(/\(\s*env\s*,\s*"([A-Z][A-Z0-9_]+)"/g, t);
    add(/\bmb\("([A-Z][A-Z0-9_]+)"/g, t);
  }
  for (const f of ["docker-compose.yml", "docker-compose.dev.yml", "proxy/Caddyfile", "backup/backup.sh", "scripts/restore.sh"]) {
    add(/\$\{?\$?\{?([A-Z][A-Z0-9_]+)/g, read(f));
  }
  // Read implicitly by Prisma (schema.prisma env("DATABASE_URL")) and by NextAuth.
  names.add("DATABASE_URL");
  names.add("NEXTAUTH_URL");
  return names;
}

const envExample = () => new Set([...read(".env.example").matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

/** Names in the first column of the "Environment variables" table of docs/ARCHITECTURE.md. */
function architectureEnvTable(): Set<string> {
  const doc = read("docs/ARCHITECTURE.md");
  const section = doc.slice(doc.indexOf("## Environment variables"));
  const table = section.slice(0, section.indexOf("\n## ", 3) === -1 ? undefined : section.indexOf("\n## ", 3));
  return new Set([...table.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]!));
}

/** "METHOD /path" for every protected route in apps/web/lib/routes.ts (the role table). */
function protectedRoutes(): string[] {
  const text = read("apps/web/lib/routes.ts");
  return [...text.matchAll(/method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)",\s*minRole:\s*"([A-Z]+)"/g)].map(
    (m) => `${m[1]} ${m[2]!.split("?")[0]!.replace(/:(\w+)/g, "{$1}")} ${m[3]}`,
  );
}

// P6-T01 / P6-T02: the "as built" documents must match the code; these checks catch drift.
describe("documentation matches the code (P6-T01, P6-T02)", () => {
  it(".env.example lists every variable the code reads at run time, and nothing else", () => {
    const code = envReadByCode();
    const tooling = [
      "CI",
      "NODE_ENV",
      "INIT_CWD",
      "NEXT_DIST_DIR",
      "BUILD_STANDALONE",
      "OPS_BASE_URL",
      "OPS_RESTORE",
      "OPS_PROJECT",
      "BACKUP_KEEP_DAYS",
      "PGHOST",
      "PGUSER",
      "PGPASSWORD",
      "PGDATABASE",
      "NODE_TLS_REJECT_UNAUTHORIZED",
    ];
    const runtime = [...code].filter((n) => !tooling.includes(n));
    const example = envExample();
    expect(runtime.filter((n) => !example.has(n)).sort(), "read by code, missing from .env.example").toEqual([]);
    expect([...example].filter((n) => !code.has(n)).sort(), "in .env.example, read by nothing").toEqual([]);
  });

  it("docs/ARCHITECTURE.md's env table covers every variable the code reads", () => {
    const table = architectureEnvTable();
    expect([...envReadByCode()].filter((n) => !table.has(n)).sort()).toEqual([]);
    expect([...envExample()].filter((n) => !table.has(n)).sort()).toEqual([]);
  });

  it("docs/ARCHITECTURE.md has the required diagrams and sections", () => {
    const doc = read("docs/ARCHITECTURE.md");
    for (const h of [
      "## Components",
      "## Request flow",
      "## Worker cycle",
      "## Data model",
      "## Environment variables",
      "## Hourly reports in the browser",
    ]) {
      expect(doc, h).toContain(h);
    }
    expect((doc.match(/```mermaid/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("CLAUDE.md lists every route with its minimum role, and the public ones", () => {
    const doc = read("CLAUDE.md");
    for (const r of protectedRoutes()) {
      const [method, path, role] = r.split(" ");
      expect(doc, r).toMatch(new RegExp(`\\|\\s*${method}\\s*\\|\\s*\`${path!.replace(/[{}]/g, "\\$&")}\`\\s*\\|\\s*${role}\\s*\\|`));
    }
    expect(doc).toContain("`/api/health`");
    expect(doc).toContain("`/api/v1/openapi.json`");
    expect(protectedRoutes().length).toBeGreaterThan(30);
  });

  it("CLAUDE.md names every table of the Prisma schema and the three roles", () => {
    const doc = read("CLAUDE.md");
    const tables = [...read("packages/db/prisma/schema.prisma").matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]!);
    expect(tables.length).toBe(10);
    for (const t of tables) expect(doc, t).toContain(`\`${t}\``);
    for (const role of ["VIEWER", "OPERATOR", "ADMIN"]) expect(doc).toContain(role);
  });

  it("CLAUDE.md points at the real location of parseMessage", () => {
    const doc = read("CLAUDE.md");
    const m = /`parseMessage`[^`\n]*`([^`]+\.ts)`/.exec(doc);
    expect(m, "CLAUDE.md must name the file of parseMessage").not.toBeNull();
    expect(existsSync(join(root, m![1]!))).toBe(true);
    expect(read(m![1]!)).toMatch(/export function parseMessage\(/);
  });

  it("CLAUDE.md keeps the standing rules", () => {
    const doc = read("CLAUDE.md");
    for (const rule of ["Parity rule", "Tests first", "One task at a time", "Never commit", "Stack is fixed"])
      expect(doc, rule).toContain(rule);
  });
});
