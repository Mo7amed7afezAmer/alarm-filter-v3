import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getDaily } from "@/app/api/v1/stats/daily/route";
import { GET as getSummary } from "@/app/api/v1/stats/summary/route";
import { GET as getTopSites } from "@/app/api/v1/stats/top-sites/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { expectedStats, NOW, seedAlarms, seedRawAndOrphans } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-36 … FR-38 against samples/export/expected-stats.json.
describe.skipIf(!testDatabaseUrl)("GET /api/v1/stats/*", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAlarms(db);
    await seedRawAndOrphans(db);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.stubEnv("ALERT_HOURS", String(expectedStats.alertHours));
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    const me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    await db?.$disconnect();
  });

  const scope = (office: string, hidden?: object) =>
    db.systemStatus.create({
      data: {
        id: 1,
        officeLabel: office,
        displayFilter: hidden ? { categories: [], alarmNames: [], ...hidden } : undefined,
        lastRunAt: new Date("2026-10-11T18:59:00Z"),
        lastRunMessages: 7,
      },
    });

  it.each(
    expectedStats.summary.map((s, i) => [`${s.office}${Object.keys(s.hidden).length ? " with hidden types" : ""} #${i}`, s] as const),
  )("summary %s (FR-36)", async (_name, s) => {
    await scope(s.office, Object.keys(s.hidden).length ? s.hidden : undefined);
    const res = await getSummary(jsonRequest("GET", "/api/v1/stats/summary"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const { mttrMinutes, ...rest } = s.expected as { mttrMinutes: Record<string, number | null> };
    expect(body).toMatchObject(rest);
    for (const [cat, v] of Object.entries(mttrMinutes)) {
      if (v === null) expect(body.mttrMinutes[cat]).toBeNull();
      else expect(body.mttrMinutes[cat]).toBeCloseTo(v, 6);
    }
    expect(body.lastRun).toEqual({ lastRunAt: "2026-10-11T18:59:00.000Z", lastRunMessages: 7, lastError: null });
  });

  it.each(expectedStats.daily.map((d) => [`${d.office} ${d.days} days`, d] as const))("daily %s (FR-37)", async (_n, d) => {
    await scope(d.office);
    const res = await getDaily(jsonRequest("GET", `/api/v1/stats/daily?days=${d.days}`));
    expect(res.status).toBe(200);
    expect((await res.json()).days).toEqual(d.expected);
  });

  it("daily defaults to 30 days", async () => {
    await scope("DN/Kafr ElDawar");
    expect((await (await getDaily(jsonRequest("GET", "/api/v1/stats/daily"))).json()).days).toHaveLength(30);
  });

  it.each(expectedStats.topSites.map((t) => [`${t.office} limit ${t.limit}`, t] as const))("top sites %s (FR-38)", async (_n, t) => {
    await scope(t.office);
    const res = await getTopSites(jsonRequest("GET", `/api/v1/stats/top-sites?limit=${t.limit}&days=${t.days}`));
    expect(res.status).toBe(200);
    expect((await res.json()).sites).toEqual(t.expected);
  });

  it.each([
    ["summary days=0", () => getSummary(jsonRequest("GET", "/api/v1/stats/summary?days=0"))],
    ["daily days=0", () => getDaily(jsonRequest("GET", "/api/v1/stats/daily?days=0"))],
    ["daily days=366", () => getDaily(jsonRequest("GET", "/api/v1/stats/daily?days=366"))],
    ["top-sites limit=0", () => getTopSites(jsonRequest("GET", "/api/v1/stats/top-sites?limit=0"))],
    ["top-sites limit=101", () => getTopSites(jsonRequest("GET", "/api/v1/stats/top-sites?limit=101"))],
  ])("400 for %s", async (_n, call) => {
    await scope("DN/Kafr ElDawar");
    expect((await call()).status).toBe(400);
  });
});
