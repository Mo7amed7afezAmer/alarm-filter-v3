import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/lib/routes";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl, type Role } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);
const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

// NFR-18 / FR-27: one table of protected routes and their minimum role. Each task adds its routes.
describe.skipIf(!testDatabaseUrl)("role table: every protected route × {VIEWER, OPERATOR}", () => {
  let db: PrismaClient;
  let target: number;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    target = (await createUser(db, "target@noc.test", "VIEWER")).id;
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it("lists every route with a minimum role", () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    for (const r of ROUTES) expect(["VIEWER", "OPERATOR", "ADMIN"]).toContain(r.minRole);
  });

  const cases = ROUTES.flatMap((r) => (["VIEWER", "OPERATOR"] as const).map((role) => [`${r.method} ${r.path}`, role, r] as const));

  it.each(cases)("%s as %s", async (_name, role, r) => {
    const me = await createUser(db, `${role.toLowerCase()}@noc.test`, role);
    session.mockResolvedValue({ id: me.id, email: me.email, role });
    const handler = (await r.load())[r.method]!;
    const params = Object.fromEntries(Object.entries(r.params ?? {}).map(([k, v]) => [k, v === ":target" ? String(target) : v]));
    const res = await handler(jsonRequest(r.method, r.path, r.body), { params });

    if (RANK[role] < RANK[r.minRole]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    } else {
      expect([401, 403]).not.toContain(res.status);
    }
  });

  it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s without a session → 401", async (_n, r) => {
    session.mockResolvedValue(null);
    const handler = (await r.load())[r.method]!;
    const res = await handler(jsonRequest(r.method, r.path, r.body), { params: r.params ?? {} });
    expect(res.status).toBe(401);
  });
});
