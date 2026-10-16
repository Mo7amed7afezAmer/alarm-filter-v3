import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getDisplay, PUT as putDisplay } from "@/app/api/v1/me/display/route";
import { GET as getPrefs, PUT as putPrefs } from "@/app/api/v1/me/notification-prefs/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

describe.skipIf(!testDatabaseUrl)("/api/v1/me/*", () => {
  let db: PrismaClient;
  let me: { id: number; email: string };

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("me/display (FR-42)", () => {
    it("starts empty", async () => {
      const res = await getDisplay(jsonRequest("GET", "/api/v1/me/display"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ categories: [], alarmNames: [] });
    });

    it("stores the user's own hidden categories and names", async () => {
      const body = { categories: ["OTHER"], alarmNames: ["S_D_N_FIRE ALARM"] };
      const put = await putDisplay(jsonRequest("PUT", "/api/v1/me/display", body));
      expect(put.status).toBe(200);
      expect(await (await getDisplay(jsonRequest("GET", "/api/v1/me/display"))).json()).toEqual(body);
      expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).displayPrefs).toEqual(body);
    });

    it("→ 400 for an invalid body", async () => {
      const res = await putDisplay(jsonRequest("PUT", "/api/v1/me/display", { categories: ["NOPE"], alarmNames: [] }));
      expect(res.status).toBe(400);
    });

    it("does not touch another user's prefs", async () => {
      const other = await createUser(db, "other@noc.test", "VIEWER");
      await putDisplay(jsonRequest("PUT", "/api/v1/me/display", { categories: ["POWER"], alarmNames: [] }));
      expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).displayPrefs).toBeNull();
    });
  });

  describe("me/notification-prefs (FR-45)", () => {
    it("defaults to DOWN only", async () => {
      const res = await getPrefs(jsonRequest("GET", "/api/v1/me/notification-prefs"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: true, categories: ["DOWN"], alarmNames: [], sites: [] });
    });

    it("stores normalized prefs", async () => {
      const body = { enabled: true, sound: true, categories: ["DOWN", "POWER"], alarmNames: ["X"], sites: ["3961DE"] };
      const put = await putPrefs(jsonRequest("PUT", "/api/v1/me/notification-prefs", body));
      expect(put.status).toBe(200);
      expect(await (await getPrefs(jsonRequest("GET", "/api/v1/me/notification-prefs"))).json()).toEqual(body);
    });

    it("→ 400 for an invalid body", async () => {
      const res = await putPrefs(jsonRequest("PUT", "/api/v1/me/notification-prefs", { enabled: "yes" }));
      expect(res.status).toBe(400);
    });
  });
});
