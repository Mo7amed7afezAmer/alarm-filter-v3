import { SEED_RULES, type PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/v1/rules/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-17: ADMIN replaces all rules (≤ 500, pattern 1–100, priority 0–100000) and every existing
// alarm is re-classified in the same transaction.
describe.skipIf(!testDatabaseUrl)("/api/v1/rules", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.rule.deleteMany();
    await db.rule.createMany({ data: SEED_RULES });
    await seedAlarms(db);
    const admin = await createUser(db, "admin@noc.test", "ADMIN");
    session.mockResolvedValue({ id: admin.id, email: admin.email, role: "ADMIN" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it("GET lists the rules by priority", async () => {
    const res = await GET(jsonRequest("GET", "/api/v1/rules"));
    expect(res.status).toBe(200);
    expect((await res.json()).rules.map((r: { pattern: string }) => r.pattern)).toEqual(SEED_RULES.map((r) => r.pattern));
  });

  it("PUT replaces every rule and re-classifies all alarms in all offices", async () => {
    const rules = [
      { pattern: "fire", category: "DOWN", priority: 5 },
      { pattern: "BCCH", category: "POWER", priority: 1 },
    ];
    const res = await PUT(jsonRequest("PUT", "/api/v1/rules", { rules }));
    expect(res.status).toBe(200);

    expect((await db.rule.findMany({ orderBy: { priority: "asc" } })).map((r) => r.pattern)).toEqual(["BCCH", "fire"]);
    const alarms = await db.alarm.findMany();
    for (const a of alarms) {
      const expected = /FIRE/i.test(a.alarmName) ? "DOWN" : /BCCH/.test(a.alarmName) ? "POWER" : "OTHER";
      expect(a.category, a.alarmName).toBe(expected);
    }
    expect(new Set(alarms.map((a) => a.office)).size).toBe(2);
  });

  it("PUT with no rules makes every alarm OTHER", async () => {
    expect((await PUT(jsonRequest("PUT", "/api/v1/rules", { rules: [] }))).status).toBe(200);
    expect(await db.alarm.count({ where: { category: { not: "OTHER" } } })).toBe(0);
  });

  it.each([
    ["more than 500 rules", { rules: Array.from({ length: 501 }, (_, i) => ({ pattern: `P${i}`, category: "OTHER", priority: i })) }],
    ["an empty pattern", { rules: [{ pattern: "", category: "DOWN", priority: 1 }] }],
    ["a pattern over 100 chars", { rules: [{ pattern: "x".repeat(101), category: "DOWN", priority: 1 }] }],
    ["a negative priority", { rules: [{ pattern: "X", category: "DOWN", priority: -1 }] }],
    ["a priority over 100000", { rules: [{ pattern: "X", category: "DOWN", priority: 100_001 }] }],
    ["an unknown category", { rules: [{ pattern: "X", category: "FIRE", priority: 1 }] }],
    ["no rules field", {}],
  ])("PUT → 400 for %s, nothing changes", async (_n, body) => {
    const res = await PUT(jsonRequest("PUT", "/api/v1/rules", body));
    expect(res.status).toBe(400);
    expect(await db.rule.count()).toBe(SEED_RULES.length);
  });

  it("accepts exactly 500 rules and priorities 0 and 100000", async () => {
    const rules = Array.from({ length: 500 }, (_, i) => ({ pattern: `P${i}`, category: "OTHER", priority: i === 0 ? 0 : 100_000 }));
    expect((await PUT(jsonRequest("PUT", "/api/v1/rules", { rules }))).status).toBe(200);
    expect(await db.rule.count()).toBe(500);
  });
});
