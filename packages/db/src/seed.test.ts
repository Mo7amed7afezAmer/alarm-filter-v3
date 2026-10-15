import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULES, seed } from "./seed";
import { freshDatabase, testDatabaseUrl, truncateAll } from "./test-db";

const ADMIN = { ADMIN_EMAIL: "admin@noc.test", ADMIN_PASSWORD: "first-password" };

// FR-16: 13 rules, DOWN then POWER, in the order REQUIREMENTS.md lists them.
const EXPECTED_RULES: [string, "DOWN" | "POWER"][] = [
  ["LINK FAILURE", "DOWN"],
  ["BTS DOWN", "DOWN"],
  ["CELL UNAVAILABLE", "DOWN"],
  ["SITE DOWN", "DOWN"],
  ["UNREACHABLE", "DOWN"],
  ["NODE DOWN", "DOWN"],
  ["MAINS", "POWER"],
  ["AC FAIL", "POWER"],
  ["BATTERY", "POWER"],
  ["RECTIFIER", "POWER"],
  ["DC LOW", "POWER"],
  ["GENERATOR", "POWER"],
  ["POWER", "POWER"],
];

describe("DEFAULT_RULES (FR-16)", () => {
  it("lists the 13 seed rules", () => {
    expect(DEFAULT_RULES.map((r) => [r.pattern, r.category])).toEqual(EXPECTED_RULES);
  });
});

describe.skipIf(!testDatabaseUrl)("seed (alarms_test)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase(testDatabaseUrl!);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("seeds 13 rules with ascending priority in the listed order", async () => {
    await seed(db, ADMIN);
    const rules = await db.rule.findMany({ orderBy: { priority: "asc" } });
    expect(rules.map((r) => [r.pattern, r.category])).toEqual(EXPECTED_RULES);
  });

  it("creates the initial ADMIN with a bcrypt hash (12 rounds)", async () => {
    await seed(db, ADMIN);
    const users = await db.user.findMany();
    expect(users).toHaveLength(1);
    const admin = users[0]!;
    expect(admin.email).toBe(ADMIN.ADMIN_EMAIL);
    expect(admin.role).toBe("ADMIN");
    expect(bcrypt.getRounds(admin.passwordHash)).toBe(12);
    expect(await bcrypt.compare(ADMIN.ADMIN_PASSWORD, admin.passwordHash)).toBe(true);
  });

  it("is idempotent: a second run changes nothing", async () => {
    await seed(db, ADMIN);
    const rulesBefore = await db.rule.findMany({ orderBy: { id: "asc" } });
    const usersBefore = await db.user.findMany({ orderBy: { id: "asc" } });

    await seed(db, ADMIN);

    expect(await db.rule.findMany({ orderBy: { id: "asc" } })).toEqual(rulesBefore);
    expect(await db.user.findMany({ orderBy: { id: "asc" } })).toEqual(usersBefore);
  });

  it("seeds rules only when the rules table is empty", async () => {
    await db.rule.create({ data: { pattern: "CUSTOM", category: "OTHER", priority: 1 } });
    await seed(db, ADMIN);
    const rules = await db.rule.findMany();
    expect(rules.map((r) => r.pattern)).toEqual(["CUSTOM"]);
  });

  it("never overwrites an existing ADMIN", async () => {
    await seed(db, ADMIN);
    const before = await db.user.findUniqueOrThrow({ where: { email: ADMIN.ADMIN_EMAIL } });

    await seed(db, { ...ADMIN, ADMIN_PASSWORD: "another-password" });

    const after = await db.user.findUniqueOrThrow({ where: { email: ADMIN.ADMIN_EMAIL } });
    expect(after).toEqual(before);
    expect(await bcrypt.compare(ADMIN.ADMIN_PASSWORD, after.passwordHash)).toBe(true);
  });

  it("skips the ADMIN when the password is shorter than 8 characters", async () => {
    await seed(db, { ADMIN_EMAIL: "admin@noc.test", ADMIN_PASSWORD: "short" });
    expect(await db.user.count()).toBe(0);
    expect(await db.rule.count()).toBe(13);
  });

  it("skips the ADMIN when ADMIN_EMAIL / ADMIN_PASSWORD are not set", async () => {
    await seed(db, {});
    expect(await db.user.count()).toBe(0);
  });
});
