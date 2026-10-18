import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

import { AGE_TICK_MS, ALARMS_REFRESH_MS, AlarmFeed, alarmsPath, BADGE_POLL_MS, siteBadges, type AlarmPage } from "./alarms";
import { ApiError, UnauthorizedError } from "./api";

const page = (total: number): AlarmPage => ({ total, page: 1, pageSize: 50, items: [] });

// P7-T03: alarm lists on the phone.
describe("alarms on the phone (P7-T03)", () => {
  it("polls like the web: ages every 30 s, lists every 60 s, the badge every 30 s (NFR-06)", () => {
    expect(AGE_TICK_MS).toBe(30_000);
    expect(ALARMS_REFRESH_MS).toBe(60_000);
    expect(BADGE_POLL_MS).toBe(30_000);
  });

  it("builds the /api/v1/alarms path from the filters, leaving out empty ones", () => {
    expect(alarmsPath({ status: "active" })).toBe("/api/v1/alarms?status=active&page=1");
    expect(alarmsPath({ status: "cleared", category: "DOWN", site: "", region: "DE", page: 2 })).toBe(
      "/api/v1/alarms?status=cleared&page=2&category=DOWN&region=DE",
    );
    expect(alarmsPath({ status: "active", minHours: "6", pageSize: 25 })).toBe(
      "/api/v1/alarms?status=active&page=1&minHours=6&pageSize=25",
    );
  });

  it("shows a VIP badge and the nodality from the Site Master fields (FR-32, FR-34)", () => {
    expect(siteBadges({ vip: true, nodality: "Hub" })).toEqual(["VIP", "Hub"]);
    expect(siteBadges({ vip: false, nodality: null })).toEqual([]);
    expect(siteBadges({ vip: null, nodality: "Tail" })).toEqual(["Tail"]);
  });

  it("offline: keeps the last data and marks it stale", async () => {
    const get = vi.fn().mockResolvedValueOnce(page(8)).mockRejectedValueOnce(new TypeError("Network request failed"));
    const feed = new AlarmFeed({ get } as never, () => new Date("2026-10-18T10:00:00Z"));
    const fresh = await feed.load({ status: "active" });
    expect(fresh).toMatchObject({ data: { total: 8 }, stale: false, error: null });

    const offline = await feed.load({ status: "active" });
    expect(offline.data?.total).toBe(8);
    expect(offline.stale).toBe(true);
    expect(offline.fetchedAt).toEqual(new Date("2026-10-18T10:00:00Z"));
    expect(offline.error).toMatch(/Network request failed/);
  });

  it("keeps the last data per filter set", async () => {
    const get = vi.fn().mockResolvedValueOnce(page(8)).mockResolvedValueOnce(page(1)).mockRejectedValue(new TypeError("offline"));
    const feed = new AlarmFeed({ get } as never);
    await feed.load({ status: "active" });
    await feed.load({ status: "active", category: "POWER" });
    expect((await feed.load({ status: "active" })).data?.total).toBe(8);
    expect((await feed.load({ status: "active", category: "POWER" })).data?.total).toBe(1);
  });

  it("a server error is shown but is not 'offline'; a 401 is passed on (sign-out)", async () => {
    const feed = new AlarmFeed({ get: vi.fn().mockRejectedValue(new ApiError(400, "BAD_REQUEST", "invalid query")) } as never);
    expect(await feed.load({ status: "active" })).toMatchObject({ data: null, stale: false, error: "invalid query" });
    const signedOut = new AlarmFeed({ get: vi.fn().mockRejectedValue(new UnauthorizedError("x")) } as never);
    await expect(signedOut.load({ status: "active" })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("clear() forgets every list (sign-out)", async () => {
    const feed = new AlarmFeed({ get: vi.fn().mockResolvedValueOnce(page(8)).mockRejectedValue(new TypeError("offline")) } as never);
    await feed.load({ status: "active" });
    feed.clear();
    expect((await feed.load({ status: "active" })).data).toBeNull();
  });
});
