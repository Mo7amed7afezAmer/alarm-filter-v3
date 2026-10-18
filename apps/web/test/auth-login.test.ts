import { createHash } from "node:crypto";
import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as alarms } from "@/app/api/v1/alarms/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const bearer = (method: string, url: string, token: string) =>
  new Request(`http://localhost${url}`, { method, headers: { Authorization: `Bearer ${token}` } });

// Decision "P7 mobile login": any user exchanges e-mail + password for an API token of their own
// (same bcrypt check and lockout as the web sign-in); logout revokes the calling token.
describe.skipIf(!testDatabaseUrl)("POST /api/v1/auth/login and /logout (P7-T02)", () => {
  let db: PrismaClient;
  let n = 0;
  let email: string;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await db.apiToken.deleteMany();
    await clearUsers(db);
    email = `viewer${++n}@noc.test`; // a fresh e-mail per test: the lockout is per e-mail and in memory
    await createUser(db, email, "VIEWER", "right-password");
    session.mockResolvedValue(null);
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const signIn = (body: unknown) => login(jsonRequest("POST", "/api/v1/auth/login", body));

  it("returns a new API token and the user; only the hash is stored, named mobile", async () => {
    const res = await signIn({ email, password: "right-password" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { id: number; email: string; role: string } };
    expect(body.user).toMatchObject({ email, role: "VIEWER" });
    const stored = await db.apiToken.findUniqueOrThrow({ where: { tokenHash: sha256(body.token) } });
    expect(stored).toMatchObject({ name: "mobile", userId: body.user.id, revokedAt: null });
  });

  it("the token calls /alarms", async () => {
    const { token } = (await (await signIn({ email, password: "right-password" })).json()) as { token: string };
    expect((await alarms(bearer("GET", "/api/v1/alarms?status=active", token))).status).toBe(200);
  });

  it("matches the e-mail case-insensitively (FR-25)", async () => {
    expect((await signIn({ email: email.toUpperCase(), password: "right-password" })).status).toBe(200);
  });

  it.each([
    ["a wrong password", () => ({ email, password: "wrong-password" })],
    ["an unknown e-mail", () => ({ email: "nobody@noc.test", password: "right-password" })],
  ])("→ 401 for %s, and no token is created", async (_n, body) => {
    const res = await signIn(body());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(await db.apiToken.count()).toBe(0);
  });

  it.each([
    ["missing password", () => ({ email })],
    ["not an e-mail", () => ({ email: "nope", password: "x" })],
  ])("→ 400 for %s", async (_n, body) => {
    expect((await signIn(body())).status).toBe(400);
  });

  it("locks the e-mail after 5 failures for 15 minutes, like the web sign-in (D-08)", async () => {
    for (let i = 0; i < 5; i++) expect((await signIn({ email, password: "wrong-password" })).status).toBe(401);
    expect((await signIn({ email, password: "right-password" })).status).toBe(401);
    expect(await db.apiToken.count()).toBe(0);
  });

  it("logout revokes the calling token (204); it then gets 401", async () => {
    const { token } = (await (await signIn({ email, password: "right-password" })).json()) as { token: string };
    expect((await logout(bearer("POST", "/api/v1/auth/logout", token))).status).toBe(204);
    expect((await db.apiToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } })).revokedAt).not.toBeNull();
    expect((await alarms(bearer("GET", "/api/v1/alarms?status=active", token))).status).toBe(401);
  });

  it("logout without a bearer token (web session) → 400, nothing revoked", async () => {
    const user = await db.user.findFirstOrThrow({ where: { email } });
    session.mockResolvedValue({ id: user.id, email, role: "VIEWER" });
    expect((await logout(jsonRequest("POST", "/api/v1/auth/logout"))).status).toBe(400);
  });
});
