import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAlarms } from "@/app/api/v1/alarms/route";
import { GET as getAlarmNames } from "@/app/api/v1/alarm-names/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { DEFAULT_OFFICE, expectedAlarmNames, expectedLists, NOW, seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-30 … FR-32, FR-40 … FR-43 against the seeded fixture samples/alarms/.
describe.skipIf(!testDatabaseUrl)("GET /api/v1/alarms and /alarm-names", () => {
  let db: PrismaClient;
  let me: { id: number; email: string };

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAlarms(db);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  async function setScope(office: string | null, admin?: object, user?: object) {
    await db.systemStatus.create({ data: { id: 1, officeLabel: office, displayFilter: admin ?? undefined } });
    if (user) await db.user.update({ where: { id: me.id }, data: { displayPrefs: user } });
  }

  function url(q: (typeof expectedLists)[number]): string {
    const params = new URLSearchParams({ status: q.status });
    for (const k of ["category", "site", "region", "minHours", "page", "pageSize", "from", "to"] as const) {
      if (q[k] !== undefined) params.set(k, String(q[k]));
    }
    return `/api/v1/alarms?${params}`;
  }

  const project = (items: Record<string, unknown>[]) =>
    items.map((i) => ({
      alarmKey: i.alarmKey,
      alarmTime: i.alarmTime,
      consecNbr: i.consecNbr,
      siteCode: i.siteCode,
      vip: i.vip,
      nodality: i.nodality,
      battery: i.battery,
      phone: i.phone,
      siteType: i.siteType,
      powerSource: i.powerSource,
    }));

  it.each(expectedLists.map((q) => [q.name, q] as const))("%s", async (_name, q) => {
    await setScope(
      q.office ?? DEFAULT_OFFICE,
      q.adminHidden ? { categories: [], alarmNames: [], ...q.adminHidden } : undefined,
      q.userHidden ? { categories: [], alarmNames: [], ...q.userHidden } : undefined,
    );
    const res = await getAlarms(jsonRequest("GET", url(q)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect({ total: body.total, page: body.page, pageSize: body.pageSize }).toEqual({
      total: q.expected.total,
      page: q.expected.page,
      pageSize: q.expected.pageSize,
    });
    expect(project(body.items)).toEqual(q.expected.items);
  });

  it("scopes to the first GMAIL_LABELS entry when no office is selected (FR-40, decided 2026-10-16)", async () => {
    vi.stubEnv("GMAIL_LABELS", `${DEFAULT_OFFICE},DS/Zagazig`);
    await setScope(null);
    const res = await getAlarms(jsonRequest("GET", "/api/v1/alarms?status=active"));
    const expected = expectedLists.find((q) => q.name === "active-default")!.expected;
    expect((await res.json()).total).toBe(expected.total);
    vi.unstubAllEnvs();
  });

  it("returns every alarm field the pages show", async () => {
    await setScope(DEFAULT_OFFICE);
    const body = await (await getAlarms(jsonRequest("GET", "/api/v1/alarms?status=cleared"))).json();
    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        "alarmKey", "alarmName", "alarmTime", "battery", "category", "cellName", "clearTime", "clearType",
        "consecNbr", "device", "durationMin", "id", "nodality", "office", "phone", "powerSource", "site",
        "siteCode", "siteType", "status", "vip",
      ].sort(),
    );
  });

  it.each([
    ["status missing", "/api/v1/alarms"],
    ["unknown status", "/api/v1/alarms?status=all"],
    ["pageSize 0", "/api/v1/alarms?status=active&pageSize=0"],
    ["pageSize 501", "/api/v1/alarms?status=active&pageSize=501"],
    ["page 0", "/api/v1/alarms?status=active&page=0"],
    ["unknown category", "/api/v1/alarms?status=active&category=FIRE"],
    ["bad minHours", "/api/v1/alarms?status=active&minHours=x"],
    ["bad from", "/api/v1/alarms?status=cleared&from=yesterday"],
  ])("400 for %s (NFR-05, NFR-23)", async (_name, path) => {
    await setScope(DEFAULT_OFFICE);
    const res = await getAlarms(jsonRequest("GET", path));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("accepts pageSize 500", async () => {
    await setScope(DEFAULT_OFFICE);
    const res = await getAlarms(jsonRequest("GET", "/api/v1/alarms?status=active&pageSize=500"));
    expect(res.status).toBe(200);
    expect((await res.json()).pageSize).toBe(500);
  });

  it("alarm names of the last 30 days, most frequent first, with hidden flags (FR-43)", async () => {
    await setScope(
      expectedAlarmNames.office,
      { categories: [], alarmNames: expectedAlarmNames.adminHidden },
      { categories: [], alarmNames: expectedAlarmNames.userHidden },
    );
    const res = await getAlarmNames(jsonRequest("GET", "/api/v1/alarm-names"));
    expect(res.status).toBe(200);
    expect((await res.json()).names).toEqual(expectedAlarmNames.expected);
  });
});
