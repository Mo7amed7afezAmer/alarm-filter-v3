import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getDisplay, PUT as putDisplay } from "@/app/api/v1/settings/display/route";
import { GET as getOffice, PUT as putOffice } from "@/app/api/v1/settings/office/route";
import { POST as postReprocess } from "@/app/api/v1/reprocess/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);
const LABELS = ["DN/Kafr ElDawar", "DN/Tanta", "DS/Zagazig"];

// FR-40 (office), FR-41 (admin hidden types), FR-24 (reprocess request). 401/403: route-table.test.ts.
describe.skipIf(!testDatabaseUrl)("ADMIN settings routes", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    await db.systemStatus.create({ data: { id: 1, availableLabels: LABELS } });
    const admin = await createUser(db, "admin@noc.test", "ADMIN");
    session.mockResolvedValue({ id: admin.id, email: admin.email, role: "ADMIN" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const status = () => db.systemStatus.findUniqueOrThrow({ where: { id: 1 } });

  describe("settings/office (FR-40)", () => {
    it("GET returns the selected office and the available labels", async () => {
      const res = await getOffice(jsonRequest("GET", "/api/v1/settings/office"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ office: null, availableLabels: LABELS });
    });

    it("PUT selects one of the available labels", async () => {
      const res = await putOffice(jsonRequest("PUT", "/api/v1/settings/office", { office: "DS/Zagazig" }));
      expect(res.status).toBe(200);
      expect((await status()).officeLabel).toBe("DS/Zagazig");
    });

    it.each([
      ["a label that is not available", { office: "DN/Nowhere" }],
      ["an empty office", { office: "" }],
      ["a missing office", {}],
    ])("PUT → 400 for %s", async (_n, body) => {
      const res = await putOffice(jsonRequest("PUT", "/api/v1/settings/office", body));
      expect(res.status).toBe(400);
      expect((await status()).officeLabel).toBeNull();
    });
  });

  describe("settings/display (FR-41)", () => {
    it("GET starts empty; PUT stores the admin list", async () => {
      expect(await (await getDisplay(jsonRequest("GET", "/api/v1/settings/display"))).json()).toEqual({ categories: [], alarmNames: [] });
      const body = { categories: ["OTHER"], alarmNames: ["S_D_N_FIRE ALARM"] };
      const res = await putDisplay(jsonRequest("PUT", "/api/v1/settings/display", body));
      expect(res.status).toBe(200);
      expect((await status()).displayFilter).toEqual(body);
      expect(await (await getDisplay(jsonRequest("GET", "/api/v1/settings/display"))).json()).toEqual(body);
    });

    it("PUT → 400 for an unknown category", async () => {
      const res = await putDisplay(jsonRequest("PUT", "/api/v1/settings/display", { categories: ["FIRE"], alarmNames: [] }));
      expect(res.status).toBe(400);
    });
  });

  describe("reprocess (FR-24)", () => {
    it("POST → 202 and sets reprocessDays for the worker", async () => {
      const res = await postReprocess(jsonRequest("POST", "/api/v1/reprocess", { days: 3 }));
      expect(res.status).toBe(202);
      expect((await status()).reprocessDays).toBe(3);
    });

    it("defaults to 7 days", async () => {
      expect((await postReprocess(jsonRequest("POST", "/api/v1/reprocess", {}))).status).toBe(202);
      expect((await status()).reprocessDays).toBe(7);
    });

    it.each([0, 91, 2.5])("POST → 400 for days=%s", async (days) => {
      expect((await postReprocess(jsonRequest("POST", "/api/v1/reprocess", { days }))).status).toBe(400);
    });
  });
});
