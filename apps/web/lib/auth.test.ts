import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearUsers, createUser, freshDatabase, testDatabaseUrl } from "@/test/db";
import { assertAuthEnv, authOptions, authorizeCredentials, SESSION_MAX_AGE_SEC } from "./auth";
import { LoginLockout } from "./lockout";

describe("NextAuth options (FR-25, NFR-20)", () => {
  it("uses JWT sessions of 12 h with an explicit secret", () => {
    expect(SESSION_MAX_AGE_SEC).toBe(12 * 3600);
    expect(authOptions.session).toMatchObject({ strategy: "jwt", maxAge: 12 * 3600 });
    expect(authOptions.jwt?.maxAge).toBe(12 * 3600);
    expect(authOptions.secret).toBe(process.env.NEXTAUTH_SECRET);
  });

  it("puts id and role on the token and the session", async () => {
    const jwt = authOptions.callbacks!.jwt!;
    const token = await jwt({ token: {}, user: { id: "3", email: "a@noc.test", role: "OPERATOR" } } as never);
    expect(token).toMatchObject({ id: 3, role: "OPERATOR" });
    const session = await authOptions.callbacks!.session!({ session: { expires: "" }, token } as never);
    expect(session).toMatchObject({ user: { id: 3, role: "OPERATOR" } });
  });
});

describe("assertAuthEnv: NEXTAUTH_SECRET required at boot", () => {
  it("throws without NEXTAUTH_SECRET", () => {
    expect(() => assertAuthEnv({})).toThrow("NEXTAUTH_SECRET");
    expect(() => assertAuthEnv({ NEXTAUTH_SECRET: "  " })).toThrow("NEXTAUTH_SECRET");
  });
  it("accepts a set secret", () => {
    expect(() => assertAuthEnv({ NEXTAUTH_SECRET: "x" })).not.toThrow();
  });
});

describe.skipIf(!testDatabaseUrl)("authorizeCredentials (FR-25, D-08) on alarms_test", () => {
  let db: PrismaClient;
  const t0 = new Date("2026-10-16T08:00:00Z").getTime();

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    await createUser(db, "Ops@NOC.test", "OPERATOR", "right-password");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const login = (email: string, password: string, lockout = new LoginLockout(), now = t0) =>
    authorizeCredentials({ email, password }, { db, lockout, now: () => now });

  it("signs in with the right password, e-mail case-insensitive", async () => {
    expect(await login("ops@noc.test", "right-password")).toMatchObject({ email: "Ops@NOC.test", role: "OPERATOR" });
    expect(await login("OPS@noc.TEST", "right-password")).not.toBeNull();
  });

  it("rejects a wrong password or an unknown e-mail", async () => {
    expect(await login("ops@noc.test", "wrong")).toBeNull();
    expect(await login("nobody@noc.test", "right-password")).toBeNull();
  });

  it("locks the e-mail for 15 minutes after 5 failed logins, even with the right password", async () => {
    const lockout = new LoginLockout();
    for (let i = 0; i < 5; i++) expect(await login("ops@noc.test", "wrong", lockout, t0 + i)).toBeNull();
    expect(await login("ops@noc.test", "right-password", lockout, t0 + 10)).toBeNull();
    expect(await login("ops@noc.test", "right-password", lockout, t0 + 4 + 15 * 60_000)).not.toBeNull();
  });

  it("counts unknown e-mails towards the lockout too", async () => {
    const lockout = new LoginLockout();
    for (let i = 0; i < 5; i++) await login("ghost@noc.test", "x", lockout, t0);
    expect(lockout.isLocked("ghost@noc.test", t0 + 1)).toBe(true);
  });
});
