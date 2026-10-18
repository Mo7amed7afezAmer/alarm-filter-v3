import { createHash } from "node:crypto";
import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as alarms } from "@/app/api/v1/alarms/route";
import { POST } from "@/app/api/v1/auth/tokens/route";
import { DELETE } from "@/app/api/v1/auth/tokens/[id]/route";
import { GET as users } from "@/app/api/v1/users/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const bearer = (url: string, token: string) => new Request(`http://localhost${url}`, { headers: { Authorization: `Bearer ${token}` } });

// P3-T07: API tokens for scripts / mobile. Decisions (2026-10-18): a token belongs to a chosen user
// and acts with that user's current role; no expiry, revoke only; POST + DELETE /{id}.
describe.skipIf(!testDatabaseUrl)("/api/v1/auth/tokens (P3-T07)", () => {
  let db: PrismaClient;
  let admin: { id: number; email: string };
  let viewer: { id: number; email: string };

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await db.apiToken.deleteMany();
    await clearUsers(db);
    admin = await createUser(db, "admin@noc.test", "ADMIN");
    viewer = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: admin.id, email: admin.email, role: "ADMIN" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  async function create(userId: number, name = "mobile") {
    const res = await POST(jsonRequest("POST", "/api/v1/auth/tokens", { userId, name }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number; name: string; userId: number; token: string; createdAt: string };
  }

  it("POST creates a token for a user and stores only its SHA-256 hash", async () => {
    const created = await create(viewer.id);
    expect(created).toMatchObject({ name: "mobile", userId: viewer.id });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const stored = await db.apiToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.tokenHash).toBe(sha256(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(stored.revokedAt).toBeNull();
  });

  it.each([
    ["missing name", { userId: 1 }],
    ["empty name", { userId: 1, name: "" }],
    ["name longer than 100", { userId: 1, name: "x".repeat(101) }],
    ["non-numeric userId", { userId: "a", name: "x" }],
  ])("POST → 400 for %s", async (_n, body) => {
    const res = await POST(jsonRequest("POST", "/api/v1/auth/tokens", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("POST → 404 for an unknown user", async () => {
    const res = await POST(jsonRequest("POST", "/api/v1/auth/tokens", { userId: 999999, name: "x" }));
    expect(res.status).toBe(404);
  });

  it("a token can call /alarms without a session", async () => {
    const { token } = await create(viewer.id);
    session.mockResolvedValue(null);
    const res = await alarms(bearer("/api/v1/alarms?status=active", token));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("items");
  });

  it("a token acts with its user's current role", async () => {
    const { token } = await create(viewer.id);
    session.mockResolvedValue(null);
    expect((await users(bearer("/api/v1/users", token))).status).toBe(403);
    await db.user.update({ where: { id: viewer.id }, data: { role: "ADMIN" } });
    expect((await users(bearer("/api/v1/users", token))).status).toBe(200);
  });

  it("a revoked token → 401", async () => {
    const { id, token } = await create(viewer.id);
    const res = await DELETE(jsonRequest("DELETE", `/api/v1/auth/tokens/${id}`), { params: { id: String(id) } });
    expect(res.status).toBe(204);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();

    session.mockResolvedValue(null);
    const after = await alarms(bearer("/api/v1/alarms?status=active", token));
    expect(after.status).toBe(401);
    expect((await after.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("an unknown bearer token → 401 even when a session cookie is present", async () => {
    const res = await alarms(bearer("/api/v1/alarms?status=active", "not-a-real-token"));
    expect(res.status).toBe(401);
  });

  it("a token stops working when its user is deleted", async () => {
    const { token } = await create(viewer.id);
    await db.user.delete({ where: { id: viewer.id } });
    session.mockResolvedValue(null);
    expect((await alarms(bearer("/api/v1/alarms?status=active", token))).status).toBe(401);
  });

  it("DELETE → 404 for an unknown token id", async () => {
    const res = await DELETE(jsonRequest("DELETE", "/api/v1/auth/tokens/999999"), { params: { id: "999999" } });
    expect(res.status).toBe(404);
  });
});
