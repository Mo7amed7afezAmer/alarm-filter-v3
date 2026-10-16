import type { PrismaClient } from "@alarm/db";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/users/route";
import { DELETE, PATCH } from "@/app/api/v1/users/[id]/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-28 (users CRUD), NFR-19 (bcrypt 12, min 8), D-2026-10-16 (404 on unknown id, /users/{id}).
describe.skipIf(!testDatabaseUrl)("/api/v1/users", () => {
  let db: PrismaClient;
  let admin: { id: number; email: string };

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    admin = await createUser(db, "admin@noc.test", "ADMIN");
    session.mockResolvedValue({ id: admin.id, email: admin.email, role: "ADMIN" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const ctx = (id: number | string) => ({ params: { id: String(id) } });

  it("GET lists users without password hashes", async () => {
    await createUser(db, "viewer@noc.test", "VIEWER");
    const res = await GET(jsonRequest("GET", "/api/v1/users"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users.map((u: { email: string }) => u.email).sort()).toEqual(["admin@noc.test", "viewer@noc.test"]);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("POST creates a user with a bcrypt hash of 12 rounds", async () => {
    const res = await POST(jsonRequest("POST", "/api/v1/users", { email: "new@noc.test", password: "12345678", role: "OPERATOR" }));
    expect(res.status).toBe(201);
    const stored = await db.user.findUniqueOrThrow({ where: { email: "new@noc.test" } });
    expect(stored.role).toBe("OPERATOR");
    expect(bcrypt.getRounds(stored.passwordHash)).toBe(12);
    expect(await bcrypt.compare("12345678", stored.passwordHash)).toBe(true);
  });

  it.each([
    ["password shorter than 8", { email: "a@noc.test", password: "1234567", role: "VIEWER" }],
    ["password longer than 200", { email: "a@noc.test", password: "x".repeat(201), role: "VIEWER" }],
    ["invalid e-mail", { email: "nope", password: "12345678", role: "VIEWER" }],
    ["unknown role", { email: "a@noc.test", password: "12345678", role: "ROOT" }],
  ])("POST → 400 for %s", async (_name, body) => {
    const res = await POST(jsonRequest("POST", "/api/v1/users", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("POST → 409 for an e-mail that already exists", async () => {
    const res = await POST(jsonRequest("POST", "/api/v1/users", { email: "admin@noc.test", password: "12345678", role: "VIEWER" }));
    expect(res.status).toBe(409);
  });

  it("PATCH changes role and password", async () => {
    const u = await createUser(db, "u@noc.test", "VIEWER");
    const res = await PATCH(jsonRequest("PATCH", `/api/v1/users/${u.id}`, { role: "OPERATOR", password: "new-password" }), ctx(u.id));
    expect(res.status).toBe(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.role).toBe("OPERATOR");
    expect(await bcrypt.compare("new-password", stored.passwordHash)).toBe(true);
  });

  it("PATCH → 404 for an unknown id", async () => {
    const res = await PATCH(jsonRequest("PATCH", "/api/v1/users/99999", { role: "VIEWER" }), ctx(99999));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("PATCH blocks an ADMIN setting their own role to VIEWER (FR-28)", async () => {
    const res = await PATCH(jsonRequest("PATCH", `/api/v1/users/${admin.id}`, { role: "VIEWER" }), ctx(admin.id));
    expect(res.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });

  it("PATCH allows an ADMIN setting their own role to OPERATOR (FR-28 as written)", async () => {
    const res = await PATCH(jsonRequest("PATCH", `/api/v1/users/${admin.id}`, { role: "OPERATOR" }), ctx(admin.id));
    expect(res.status).toBe(200);
  });

  it("DELETE removes another user", async () => {
    const u = await createUser(db, "u@noc.test", "VIEWER");
    const res = await DELETE(jsonRequest("DELETE", `/api/v1/users/${u.id}`), ctx(u.id));
    expect(res.status).toBe(204);
    expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
  });

  it("DELETE → 404 for an unknown id", async () => {
    expect((await DELETE(jsonRequest("DELETE", "/api/v1/users/99999"), ctx(99999))).status).toBe(404);
  });

  it("DELETE blocks deleting yourself (FR-28)", async () => {
    const res = await DELETE(jsonRequest("DELETE", `/api/v1/users/${admin.id}`), ctx(admin.id));
    expect(res.status).toBe(400);
    expect(await db.user.findUnique({ where: { id: admin.id } })).not.toBeNull();
  });

  it("→ 400 for a non-numeric id", async () => {
    expect((await DELETE(jsonRequest("DELETE", "/api/v1/users/abc"), ctx("abc"))).status).toBe(400);
  });
});
