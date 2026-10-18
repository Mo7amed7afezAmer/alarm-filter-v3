import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAlarmNames } from "@/app/api/v1/alarm-names/route";
import { GET as getNotifications } from "@/app/api/v1/notifications/route";
import { GET as getTopSites } from "@/app/api/v1/stats/top-sites/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const NOW = new Date("2026-10-11T19:00:00Z");
const OFFICE = "DN/Kafr ElDawar";
const OTHER_OFFICE = "DN/Other";
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Row = { alarmName: string; site: string; category?: "DOWN" | "POWER" | "OTHER"; at: Date; office?: string; createdAt?: Date };
let seq = 0;
const row = (r: Row) => ({
  alarmKey: `${r.alarmName}||${r.site}||${seq++}`,
  alarmName: r.alarmName,
  site: r.site,
  category: r.category ?? "OTHER",
  alarmTime: r.at,
  createdAt: r.createdAt ?? r.at,
  office: r.office ?? OFFICE,
});
const times = (n: number, f: (i: number) => Row) => Array.from({ length: n }, (_, i) => row(f(i)));

// Limits and defaults of FR-38, FR-43 and FR-44 that the fixture data is too small to reach.
describe.skipIf(!testDatabaseUrl)("FR-38 / FR-43 / FR-44 limits and defaults", () => {
  let db: PrismaClient;
  let me: { id: number; email: string };

  beforeAll(async () => {
    db = await freshDatabase();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await db.alarm.deleteMany();
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    await db.systemStatus.create({ data: { id: 1, officeLabel: OFFICE } });
    me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  it("FR-38: top sites default to limit 10 and a 30-day window", async () => {
    await db.alarm.createMany({
      data: [
        // 12 distinct sites in the window: SITE01 has 1 alarm … SITE12 has 12.
        ...Array.from({ length: 12 }, (_, s) =>
          times(s + 1, () => ({ alarmName: "A", site: `SITE${String(s + 1).padStart(2, "0")}`, at: ago(DAY) })),
        ).flat(),
        // 29 days old: inside the default window, most alarms → first.
        ...times(40, () => ({ alarmName: "A", site: "IN29", at: ago(29 * DAY) })),
        // 31 days old: outside the default window even though it has the most alarms.
        ...times(50, () => ({ alarmName: "A", site: "OLD31", at: ago(31 * DAY) })),
      ],
    });

    const res = await getTopSites(jsonRequest("GET", "/api/v1/stats/top-sites"));
    expect(res.status).toBe(200);
    const sites = (await res.json()).sites as { site: string; total: number; active: number }[];
    expect(sites).toHaveLength(10);
    expect(sites.map((s) => [s.site, s.total])).toEqual([
      ["IN29", 40],
      ["SITE12", 12],
      ["SITE11", 11],
      ["SITE10", 10],
      ["SITE09", 9],
      ["SITE08", 8],
      ["SITE07", 7],
      ["SITE06", 6],
      ["SITE05", 5],
      ["SITE04", 4],
    ]);
    expect(sites.every((s) => s.active === s.total)).toBe(true);

    // An explicit days=32 brings OLD31 back, so the default above really is 30.
    const wide = (await (await getTopSites(jsonRequest("GET", "/api/v1/stats/top-sites?days=32"))).json()).sites as { site: string }[];
    expect(wide[0]?.site).toBe("OLD31");
  });

  it("FR-43: alarm names cap at 300, most frequent first, last 30 days of the current office", async () => {
    await db.alarm.createMany({
      data: [
        // 310 distinct names with 1 alarm each.
        ...Array.from({ length: 310 }, (_, i) => row({ alarmName: `N${String(i).padStart(3, "0")}`, site: "S", at: ago(DAY) })),
        // Names that occur more often, to check the order.
        ...times(5, () => ({ alarmName: "FREQ5", site: "S", at: ago(DAY) })),
        ...times(3, () => ({ alarmName: "FREQ3", site: "S", at: ago(2 * DAY) })),
        // 29 days old: inside the window.
        ...times(20, () => ({ alarmName: "IN29", site: "S", at: ago(29 * DAY) })),
        // 31 days old: outside the window.
        ...times(50, () => ({ alarmName: "OLD31", site: "S", at: ago(31 * DAY) })),
        // Another office: not listed.
        ...times(60, () => ({ alarmName: "ELSEWHERE", site: "S", at: ago(DAY), office: OTHER_OFFICE })),
      ],
    });

    const res = await getAlarmNames(jsonRequest("GET", "/api/v1/alarm-names"));
    expect(res.status).toBe(200);
    const names = (await res.json()).names as { alarmName: string; count: number; hidden: boolean; hiddenByMe: boolean }[];
    expect(names).toHaveLength(300);
    expect(names.slice(0, 3).map((n) => [n.alarmName, n.count])).toEqual([
      ["IN29", 20],
      ["FREQ5", 5],
      ["FREQ3", 3],
    ]);
    const counts = names.map((n) => n.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(names.slice(3).every((n) => /^N\d{3}$/.test(n.alarmName) && n.count === 1)).toBe(true);
    expect(new Set(names.map((n) => n.alarmName)).size).toBe(300);
    expect(names.some((n) => n.alarmName === "OLD31" || n.alarmName === "ELSEWHERE")).toBe(false);
    expect(names.every((n) => n.hidden === false && n.hiddenByMe === false)).toBe(true);
  });

  it("FR-44: the feed scans at most the 2000 newest alarms in scope", async () => {
    // Default prefs: DOWN only. Newest first: 5 DOWN, then 1995 OTHER (2000 scanned), then one
    // older DOWN alarm that is still inside 24 h but beyond the scan window.
    const minutes = (m: number) => ago(m * 60_000);
    await db.alarm.createMany({
      data: [
        ...times(5, (i) => ({ alarmName: "D", site: `NEW${i}`, category: "DOWN", at: minutes(1 + i * 0.1) })),
        ...times(1995, (i) => ({ alarmName: "O", site: `O${i}`, category: "OTHER", at: minutes(2 + i * 0.1) })),
        row({ alarmName: "D", site: "BEYOND", category: "DOWN", at: minutes(600) }),
        // Another office: not in scope, so it does not use up the scan.
        ...times(100, (i) => ({ alarmName: "O", site: `X${i}`, category: "OTHER", at: minutes(0.5), office: OTHER_OFFICE })),
      ],
    });

    const feed = async () => {
      const res = await getNotifications(jsonRequest("GET", "/api/v1/notifications"));
      expect(res.status).toBe(200);
      return ((await res.json()).items as { site: string }[]).map((i) => i.site);
    };
    expect(await feed()).toEqual(["NEW0", "NEW1", "NEW2", "NEW3", "NEW4"]);

    // One fewer newer alarm puts BEYOND at position 2000 → it is scanned and returned.
    await db.alarm.deleteMany({ where: { site: "O0" } });
    expect(await feed()).toEqual(["NEW0", "NEW1", "NEW2", "NEW3", "NEW4", "BEYOND"]);
  });

  it("FR-44: the feed holds at most 50 items, newest first", async () => {
    await db.alarm.createMany({
      data: times(80, (i) => ({ alarmName: "D", site: `S${i}`, category: "DOWN", at: ago((i + 1) * 60_000) })),
    });
    const res = await getNotifications(jsonRequest("GET", "/api/v1/notifications"));
    const items = (await res.json()).items as { site: string }[];
    expect(items.map((i) => i.site)).toEqual(Array.from({ length: 50 }, (_, i) => `S${i}`));
  });
});
