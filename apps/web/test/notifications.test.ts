import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/notifications/route";
import { POST as markRead } from "@/app/api/v1/notifications/read/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { alarmsFixture, DEFAULT_OFFICE, NOW, seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-44 feed, FR-45 prefs, FR-46 mark-all-read. The fixture's createdAt equals alarmTime (13:00–14:45Z)
// and "now" is 19:00Z, so every alarm is inside the 24 h window.
describe.skipIf(!testDatabaseUrl)("/api/v1/notifications", () => {
  let db: PrismaClient;
  let me: { id: number; email: string };

  const inOffice = alarmsFixture.alarms.filter((a) => a.office === DEFAULT_OFFICE);
  const downInOffice = inOffice.filter((a) => a.category === "DOWN");

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAlarms(db);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    await db.systemStatus.create({ data: { id: 1, officeLabel: DEFAULT_OFFICE } });
    me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  const feed = async () => {
    const res = await GET(jsonRequest("GET", "/api/v1/notifications"));
    expect(res.status).toBe(200);
    return (await res.json()) as { items: { alarmName: string; category: string; unread: boolean }[]; unread: number; sound: boolean };
  };
  const setPrefs = (prefs: object) => db.user.update({ where: { id: me.id }, data: { notifyPrefs: prefs } });

  it("default prefs: DOWN alarms of the office, newest first", async () => {
    const body = await feed();
    expect(body.items.map((i) => i.category)).toEqual(downInOffice.map(() => "DOWN"));
    expect(body.items).toHaveLength(downInOffice.length);
  });

  it("first visit: unread counts only the last 30 minutes", async () => {
    expect((await feed()).unread).toBe(0);
  });

  it("unread = created after notificationsSeenAt", async () => {
    await db.user.update({ where: { id: me.id }, data: { notificationsSeenAt: new Date("2026-10-11T00:00:00Z") } });
    const body = await feed();
    expect(body.unread).toBe(downInOffice.length);
    expect(body.items.every((i) => i.unread)).toBe(true);
  });

  it("mark all read sets notificationsSeenAt to now (FR-46)", async () => {
    await db.user.update({ where: { id: me.id }, data: { notificationsSeenAt: new Date("2026-10-11T00:00:00Z") } });
    expect((await markRead(jsonRequest("POST", "/api/v1/notifications/read"))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).notificationsSeenAt).toEqual(NOW);
    expect((await feed()).unread).toBe(0);
  });

  it("an alarm recreated with its original createdAt stays read (gap 23 fix)", async () => {
    await markRead(jsonRequest("POST", "/api/v1/notifications/read"));
    const a = await db.alarm.findFirstOrThrow({ where: { office: DEFAULT_OFFICE, category: "DOWN" } });
    await db.alarm.delete({ where: { id: a.id } });
    await db.alarm.create({ data: { ...a, id: undefined } });
    expect((await feed()).unread).toBe(0);
  });

  it("follows the user's prefs (FR-45): all categories, filtered by site", async () => {
    await setPrefs({ enabled: true, sound: true, categories: [], alarmNames: [], sites: ["SHARAQA"] });
    const body = await feed();
    expect(body.sound).toBe(true);
    expect(body.items.length).toBe(inOffice.filter((a) => a.site.includes("SHARAQA")).length);
  });

  it("returns nothing when notifications are disabled", async () => {
    await setPrefs({ enabled: false, sound: false, categories: [], alarmNames: [], sites: [] });
    expect((await feed()).items).toEqual([]);
  });

  it("leaves out hidden alarm types (FR-41)", async () => {
    await setPrefs({ enabled: true, sound: false, categories: [], alarmNames: [], sites: [] });
    await db.systemStatus.update({ where: { id: 1 }, data: { displayFilter: { categories: ["OTHER"], alarmNames: [] } } });
    expect((await feed()).items.every((i) => i.category !== "OTHER")).toBe(true);
  });

  it("holds at most 50 items", async () => {
    await setPrefs({ enabled: true, sound: false, categories: [], alarmNames: [], sites: [] });
    const t = new Date(NOW.getTime() - 60_000);
    await db.alarm.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        alarmKey: `N||S${i}`, alarmName: "N", site: `S${i}`, category: "OTHER" as const, alarmTime: t, createdAt: t, office: DEFAULT_OFFICE,
      })),
    });
    expect((await feed()).items).toHaveLength(50);
    await db.alarm.deleteMany({ where: { alarmName: "N" } });
  });

  it("leaves out alarms created more than 24 h ago", async () => {
    await setPrefs({ enabled: true, sound: false, categories: [], alarmNames: [], sites: [] });
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 86_400_000));
    try {
      expect((await feed()).items).toEqual([]);
    } finally {
      vi.setSystemTime(NOW);
    }
  });
});
