import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetSchema, migrateDeploy, testClient, testDatabaseUrl } from "./test-db";

// REQUIREMENTS.md §5: nine models.
const TABLES = [
  "alarms",
  "hourly_normalizations",
  "orphan_clears",
  "raw_messages",
  "rules",
  "site_master",
  "sites",
  "system_status",
  "users",
];

describe.skipIf(!testDatabaseUrl)("migrations (alarms_test)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = testClient(testDatabaseUrl!);
    await resetSchema(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("applies on a fresh database", async () => {
    const out = migrateDeploy(testDatabaseUrl!);
    expect(out).toMatch(/applied|No pending migrations/i);

    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
  });

  it("creates the enums from §5", async () => {
    const rows = await db.$queryRaw<{ name: string; value: string }[]>`
      SELECT t.typname AS name, e.enumlabel AS value
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      ORDER BY t.typname, e.enumsortorder`;
    const enums: Record<string, string[]> = {};
    for (const r of rows) (enums[r.name] ??= []).push(r.value);
    expect(enums).toEqual({
      AlarmStatus: ["ACTIVE", "CLEARED"],
      Category: ["DOWN", "POWER", "OTHER"],
      ClearType: ["EMAIL", "AUTO_SUPERSEDED"],
      Role: ["VIEWER", "OPERATOR", "ADMIN"],
    });
  });

  it("creates the unique keys and indexes from §5", async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const defs = rows.map((r) => r.indexdef.replace(/"/g, ""));
    const has = (re: RegExp) =>
      expect(
        defs.some((d) => re.test(d)),
        String(re),
      ).toBe(true);

    has(/UNIQUE INDEX .* ON public\.raw_messages .*\(gmailId\)/);
    has(/ON public\.raw_messages .*\(receivedAt\)/);
    has(/ON public\.raw_messages .*\(office\)/);
    has(/UNIQUE INDEX .* ON public\.alarms .*\(consecNbr\)/);
    has(/ON public\.alarms .*\(alarmKey, alarmTime\)/);
    has(/ON public\.alarms .*\(status, category\)/);
    has(/ON public\.alarms .*\(office, status\)/);
    has(/ON public\.alarms .*\(site\)/);
    has(/ON public\.orphan_clears .*\(alarmKey\)/);
    has(/ON public\.orphan_clears .*\(consecNbr\)/);
    has(/ON public\.rules .*\(priority\)/);
    has(/UNIQUE INDEX .* ON public\.users .*\(email\)/);
    has(/ON public\.site_master .*\(office\)/);
    has(/UNIQUE INDEX .* ON public\.hourly_normalizations .*\(field, from\)/);
  });

  it("deletes orphan clears with their raw message (onDelete Cascade)", async () => {
    const raw = await db.rawMessage.create({
      data: { gmailId: "g-cascade", subject: "CLEARED_X on #S# at |01-JAN-2026 00:00:00|", receivedAt: new Date() },
    });
    await db.orphanClear.create({
      data: { alarmKey: "X||S", subject: raw.subject, clearTime: raw.receivedAt, rawMessageId: raw.id },
    });
    await db.rawMessage.delete({ where: { id: raw.id } });
    expect(await db.orphanClear.count()).toBe(0);
  });

  it("is a no-op when run again", () => {
    expect(migrateDeploy(testDatabaseUrl!)).toMatch(/No pending migrations/i);
  });
});
