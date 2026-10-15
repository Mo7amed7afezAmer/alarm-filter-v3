import { PrismaClient } from "@alarm/db";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbSink, ingestOnce } from "./ingest";
import { GONE_ID, LABEL, MockGmail, SAMPLE_IDS } from "./test/mock-gmail";

const url = process.env.TEST_DATABASE_URL;
const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));

describe.skipIf(!url)("ingestOnce → raw_messages (alarms_test)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    if (new URL(url!).pathname !== "/alarms_test") throw new Error("TEST_DATABASE_URL must point at alarms_test");
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await db.$executeRawUnsafe("CREATE SCHEMA public");
    execSync("pnpm exec prisma migrate deploy", { cwd: dbPackage, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("duplicate message → no new row (FR-04, NFR-11)", async () => {
    const opts = {
      lastHistoryId: "8000",
      officeChanged: false,
      label: LABEL,
      office: LABEL.name,
      now: new Date("2026-10-11T19:00:00Z"),
      backfillHours: 24,
      maxPerRun: 200,
      query: "",
    };
    const first = await ingestOnce(new MockGmail(), dbSink(db), opts);
    const second = await ingestOnce(new MockGmail(), dbSink(db), opts);

    expect(first.inserted).toBe(SAMPLE_IDS.length - 1);
    expect(second.inserted).toBe(0);
    const rows = await db.rawMessage.findMany({ orderBy: { receivedAt: "asc" } });
    expect(rows.map((r) => r.gmailId)).toEqual(SAMPLE_IDS.filter((id) => id !== GONE_ID));
    expect(rows.every((r) => r.office === "DN" && r.processedAt === null)).toBe(true);
  });
});
