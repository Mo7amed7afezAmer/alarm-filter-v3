import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAlarms } from "@/app/api/v1/alarms/route";
import { issueToken } from "@/lib/api-tokens";
import { ageText, alarmsQuery } from "@/lib/alarm-ui";
import { getSessionUser } from "@/lib/session";
import { ageText as mobileAgeText, alarmsPath } from "../../mobile/src/alarms";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { DEFAULT_OFFICE, expectedLists, NOW, seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

type Case = (typeof expectedLists)[number];
const FILTERS = ["category", "site", "region", "minHours", "from", "to"] as const;
const filtersOf = (q: Case) => Object.fromEntries(FILTERS.filter((k) => q[k] !== undefined).map((k) => [k, String(q[k])]));

// P7-T03 contract: for the same filters the mobile app gets the same alarm counts as the web, against
// the seeded fixture samples/alarms/ (each case of expected-lists.json).
describe.skipIf(!testDatabaseUrl)("mobile ↔ web alarm counts (P7-T03 contract)", () => {
  let db: PrismaClient;
  let me: { id: number; email: string };
  let token: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAlarms(db);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await db.apiToken.deleteMany();
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    me = await createUser(db, "viewer@noc.test", "VIEWER");
    token = await issueToken(db, me.id, "mobile");
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  it.each(expectedLists.map((q) => [q.name, q] as const))("%s: same total on web and mobile", async (_n, q) => {
    await db.systemStatus.create({
      data: {
        id: 1,
        officeLabel: q.office ?? DEFAULT_OFFICE,
        displayFilter: q.adminHidden ? { categories: [], alarmNames: [], ...q.adminHidden } : undefined,
      },
    });
    if (q.userHidden)
      await db.user.update({ where: { id: me.id }, data: { displayPrefs: { categories: [], alarmNames: [], ...q.userHidden } } });

    // Web: the page's query with the signed-in session.
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
    const webQuery = alarmsQuery(q.status as "active" | "cleared", q.page ?? 1, filtersOf(q), q.pageSize);
    const web = (await (await getAlarms(jsonRequest("GET", `/api/v1/alarms?${webQuery}`))).json()) as { total: number };

    // Mobile: the app's path with its bearer token, no session.
    session.mockResolvedValue(null);
    const path = alarmsPath({ status: q.status as "active" | "cleared", page: q.page, pageSize: q.pageSize, ...filtersOf(q) });
    const res = await getAlarms(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const mobile = (await res.json()) as { total: number };

    expect(mobile.total).toBe(web.total);
    expect(mobile.total).toBe(q.expected.total);
  });

  it.each([0, 59_000, 60_000, 3_600_000, 3_660_000, 86_400_000 + 7_200_000, -5_000])("age text for %i ms matches the web", (ms) => {
    const now = new Date("2026-10-11T19:00:00Z");
    const t = new Date(now.getTime() - ms);
    expect(mobileAgeText(t, now)).toBe(ageText(t, now));
  });
});
