import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@alarm/db";

// samples/alarms/ — seeded alarms, Site Master rows and expected list results (approved 2026-10-16).
const dir = fileURLToPath(new URL("../../../samples/alarms/", import.meta.url));
const load = <T>(file: string): T => JSON.parse(readFileSync(dir + file, "utf8")) as T;

export interface FixtureAlarm {
  alarmKey: string;
  alarmName: string;
  site: string;
  category: "DOWN" | "POWER" | "OTHER";
  alarmTime: string;
  status: "ACTIVE" | "CLEARED";
  clearTime: string | null;
  durationMin: number | null;
  clearType: "EMAIL" | "AUTO_SUPERSEDED" | null;
  consecNbr: string | null;
  cellName: string | null;
  device: string | null;
  office: string;
  createdAt: string;
}

export const alarmsFixture = load<{ now: string; alarms: FixtureAlarm[] }>("alarms.json");
export const siteMasterFixture = load<Record<string, unknown>[]>("site-master.json");
export const expectedLists = load<
  {
    name: string;
    status: "active" | "cleared";
    office?: string;
    category?: string;
    site?: string;
    region?: string;
    minHours?: number;
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    adminHidden?: { categories?: string[]; alarmNames?: string[] };
    userHidden?: { categories?: string[]; alarmNames?: string[] };
    expected: { total: number; page: number; pageSize: number; items: Record<string, unknown>[] };
  }[]
>("expected-lists.json");
export const expectedAlarmNames = load<{
  office: string;
  adminHidden: string[];
  userHidden: string[];
  expected: { alarmName: string; count: number; hidden: boolean; hiddenByMe: boolean }[];
}>("expected-alarm-names.json");

export const NOW = new Date(alarmsFixture.now);
export const DEFAULT_OFFICE = "DN/Kafr ElDawar";

/** Loads samples/alarms into an empty alarms_test, in file order (ids follow the file). */
export async function seedAlarms(db: PrismaClient): Promise<void> {
  await db.alarm.deleteMany();
  await db.siteMaster.deleteMany();
  for (const a of alarmsFixture.alarms) {
    await db.alarm.create({
      data: {
        ...a,
        alarmTime: new Date(a.alarmTime),
        clearTime: a.clearTime ? new Date(a.clearTime) : null,
        createdAt: new Date(a.createdAt),
      },
    });
  }
  for (const s of siteMasterFixture) await db.siteMaster.create({ data: s as never });
}

export const rawAndOrphansFixture = load<{
  rawMessages: {
    gmailId: string;
    subject: string;
    receivedAt: string;
    body: string | null;
    office: string;
    parseError: string | null;
    processedAt: string;
  }[];
  orphanClears: { alarmKey: string; subject: string; clearTime: string; consecNbr: string | null; office: string; gmailId: string }[];
}>("raw-and-orphans.json");

/** Loads samples/alarms/raw-and-orphans.json (raw messages and the orphan clears that point at them). */
export async function seedRawAndOrphans(db: PrismaClient): Promise<void> {
  await db.orphanClear.deleteMany();
  await db.rawMessage.deleteMany();
  await db.rawMessage.createMany({
    data: rawAndOrphansFixture.rawMessages.map((r) => ({
      ...r,
      receivedAt: new Date(r.receivedAt),
      processedAt: new Date(r.processedAt),
    })),
  });
  const ids = new Map((await db.rawMessage.findMany({ select: { id: true, gmailId: true } })).map((r) => [r.gmailId, r.id]));
  for (const { gmailId, ...o } of rawAndOrphansFixture.orphanClears) {
    await db.orphanClear.create({ data: { ...o, clearTime: new Date(o.clearTime), rawMessageId: ids.get(gmailId)! } });
  }
}

const exportDir = fileURLToPath(new URL("../../../samples/export/", import.meta.url));
const loadExport = <T>(file: string): T => JSON.parse(readFileSync(exportDir + file, "utf8")) as T;

export const expectedExports =
  loadExport<{ name: string; query: string; office: string; sheet: string; cells: (string | number | null)[][] }[]>(
    "expected-exports.json",
  );

export interface ExpectedStats {
  now: string;
  alertHours: number;
  summary: { office: string; hidden: { categories?: string[]; alarmNames?: string[] }; expected: Record<string, unknown> }[];
  daily: { office: string; days: number; expected: Record<string, unknown>[] }[];
  topSites: { office: string; limit: number; days: number; expected: Record<string, unknown>[] }[];
}
export const expectedStats = loadExport<ExpectedStats>("expected-stats.json");
