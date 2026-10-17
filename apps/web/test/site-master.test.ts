import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { GET as getAlarms } from "@/app/api/v1/alarms/route";
import { GET as getNormalizations, PUT as putNormalizations } from "@/app/api/v1/hourly-normalizations/route";
import { GET as getReference } from "@/app/api/v1/hourly-reference/route";
import { PUT as putSite } from "@/app/api/v1/site-master/[code]/route";
import { POST as importSites } from "@/app/api/v1/site-master/import/route";
import { GET as listSites } from "@/app/api/v1/site-master/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl, type Role } from "./db";
import { DEFAULT_OFFICE, seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// G-T15: Site Master import / list / edit (FR-65 … FR-67), hourly normalizations (FR-68) and the
// hourly reference data the browser caches (G-T14 / G-T15 decisions of 2026-10-17).
const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../samples/hourly/site-master.json", import.meta.url)), "utf8"),
) as Record<string, string | boolean | null>[];
/** The sites the import keeps: the first row per code (samples/hourly repeats 0970DE twice → 136 of 138). */
const sites = sample.filter((r, i) => sample.findIndex((s) => s.code === r.code) === i);

/** The import workbook, generated from samples/hourly/site-master.json plus 2 invalid rows (decided 2026-10-17). */
function workbook(rows = sample, extra: Record<string, unknown>[] = [{ Code: "bad", Office: "X" }, { Code: "0999DE", Office: "" }]): Uint8Array<ArrayBuffer> {
  const sheet = XLSX.utils.json_to_sheet([
    ...rows.map((r) => ({
      Code: r.code,
      "Site Name": r.siteName ?? "",
      Office: r.office ?? "",
      Nodality: r.nodality ?? "",
      VIP: r.vip ? "Yes" : "No",
      "Site Type": r.siteType ?? "",
      "Power Source": r.powerSource ?? "",
      Battery: r.battery ?? "",
      "Guard Number": r.phone ?? "",
      Notes: r.notes ?? "",
    })),
    ...extra,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["cover"]]), "Cover");
  XLSX.utils.book_append_sheet(wb, sheet, "SiteMaster");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function upload(bytes: Uint8Array<ArrayBuffer>, name = "site-master.xlsx"): Request {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  return new Request("http://localhost/api/v1/site-master/import", { method: "POST", body: form });
}

describe.skipIf(!testDatabaseUrl)("G-T15 Site Master and normalizations", () => {
  let db: PrismaClient;
  const as = async (role: Role) => {
    const u = await createUser(db, `${role.toLowerCase()}@noc.test`, role);
    session.mockResolvedValue({ id: u.id, email: u.email, role });
  };

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.hourlyNormalization.deleteMany();
    await db.systemStatus.deleteMany();
    await db.systemStatus.create({ data: { id: 1, officeLabel: DEFAULT_OFFICE } });
    await seedAlarms(db);
    await db.siteMaster.deleteMany();
    await as("ADMIN");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("POST /site-master/import (FR-65, NFR-25)", () => {
    it("upserts by code and returns inserted / updated / skipped", async () => {
      const res = await importSites(upload(workbook()));
      expect(res.status).toBe(200);
      expect(sites).toHaveLength(136);
      expect(await res.json()).toEqual({ inserted: 136, updated: 0, skipped: 4 });
      expect(await db.siteMaster.count()).toBe(136);
      const row = await db.siteMaster.findUnique({ where: { code: String(sample[0]!.code) } });
      expect(row).toMatchObject({ office: sample[0]!.office, vip: sample[0]!.vip, region: String(sample[0]!.code).slice(-2) });
    });

    it("is idempotent: a second import updates the same rows and changes nothing", async () => {
      await importSites(upload(workbook()));
      const before = await db.siteMaster.findMany({ orderBy: { code: "asc" } });
      const res = await importSites(upload(workbook()));
      expect(await res.json()).toEqual({ inserted: 0, updated: 136, skipped: 4 });
      const after = await db.siteMaster.findMany({ orderBy: { code: "asc" } });
      const strip = (rows: typeof before) => rows.map((r) => ({ ...r, updatedAt: null }));
      expect(strip(after)).toEqual(strip(before));
    });

    it("updates an existing site from the file", async () => {
      await importSites(upload(workbook()));
      const changed = sample.map((r, i) => (i === 0 ? { ...r, battery: "8h" } : r));
      expect(await (await importSites(upload(workbook(changed)))).json()).toMatchObject({ inserted: 0, updated: 136 });
      expect((await db.siteMaster.findUnique({ where: { code: String(sample[0]!.code) } }))!.battery).toBe("8h");
    });

    it("413 above 5 MB", async () => {
      const res = await importSites(upload(new Uint8Array(5 * 1024 * 1024 + 1)));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe("TOO_LARGE");
    });

    it("400 for a file that is not .xlsx, or no file", async () => {
      expect((await importSites(upload(workbook(), "sites.csv"))).status).toBe(400);
      expect((await importSites(upload(new Uint8Array([1, 2, 3, 4])))).status).toBe(400);
      expect((await importSites(new Request("http://localhost/api/v1/site-master/import", { method: "POST", body: new FormData() }))).status).toBe(400);
    });

    it("403 for an OPERATOR", async () => {
      await as("OPERATOR");
      expect((await importSites(upload(workbook()))).status).toBe(403);
    });
  });

  describe("GET /site-master (FR-67)", () => {
    beforeEach(async () => {
      await importSites(upload(workbook()));
      await as("VIEWER");
    });

    it("any signed-in user can list, paginated by code", async () => {
      const res = await listSites(jsonRequest("GET", "/api/v1/site-master?pageSize=10&page=2"));
      expect(res.status).toBe(200);
      const body = await res.json();
      const codes = sites.map((r) => String(r.code)).sort();
      expect(body).toMatchObject({ total: sites.length, page: 2, pageSize: 10 });
      expect(body.items.map((r: { code: string }) => r.code)).toEqual(codes.slice(10, 20));
    });

    it("filters by office and by q (code or site name, case-insensitive)", async () => {
      const office = String(sample[0]!.office);
      const byOffice = await (await listSites(jsonRequest("GET", `/api/v1/site-master?office=${encodeURIComponent(office)}&pageSize=500`))).json();
      expect(byOffice.total).toBe(sites.filter((r) => r.office === office).length);
      const name = String(sample[0]!.siteName);
      const q = name.slice(0, 6).toLowerCase();
      const byQ = await (await listSites(jsonRequest("GET", `/api/v1/site-master?q=${encodeURIComponent(q)}&pageSize=500`))).json();
      const expected = sites.filter((r) => String(r.code).toLowerCase().includes(q) || String(r.siteName ?? "").toLowerCase().includes(q));
      expect(byQ.total).toBe(expected.length);
    });

    it("401 without a session", async () => {
      session.mockResolvedValue(null);
      expect((await listSites(jsonRequest("GET", "/api/v1/site-master"))).status).toBe(401);
    });
  });

  describe("PUT /site-master/{code} (FR-67)", () => {
    const code = "0444DE";
    beforeEach(async () => {
      await db.siteMaster.create({ data: { code, office: "KAFR EL DAWAR", region: "DE" } });
    });

    it("edits every field", async () => {
      const edit = {
        siteName: "Kafr 1",
        office: "  damanhour ",
        nodality: "2+0",
        vip: true,
        siteType: "Macro",
        powerSource: "Mains",
        battery: "4h",
        phone: "+20 (100) 123-4567 / 0111",
        notes: "gate code 12",
      };
      const res = await putSite(jsonRequest("PUT", `/api/v1/site-master/${code}`, edit), { params: { code } });
      expect(res.status).toBe(200);
      expect((await res.json()).site).toMatchObject({ ...edit, office: "DAMANHOUR", code });
      expect(await db.siteMaster.findUnique({ where: { code } })).toMatchObject({ ...edit, office: "DAMANHOUR" });
    });

    it("400 for a phone outside [\\d+ /()-] or an empty office", async () => {
      for (const body of [{ phone: "0100 ext. 5" }, { office: "  " }]) {
        expect((await putSite(jsonRequest("PUT", `/api/v1/site-master/${code}`, body), { params: { code } })).status).toBe(400);
      }
    });

    it("404 for an unknown code; 403 for an OPERATOR", async () => {
      expect((await putSite(jsonRequest("PUT", "/api/v1/site-master/0999DE", { vip: true }), { params: { code: "0999DE" } })).status).toBe(404);
      await as("OPERATOR");
      expect((await putSite(jsonRequest("PUT", `/api/v1/site-master/${code}`, { vip: true }), { params: { code } })).status).toBe(403);
    });

    it("editing VIP shows on /alarms (FR-32, FR-34)", async () => {
      // samples/alarms: BH-UMB-BH_3926DE is active in the default office.
      const site = "3926DE";
      await db.siteMaster.create({ data: { code: site, office: "KAFR EL DAWAR", region: "DE", vip: false } });
      const vipOf = async () => {
        const body = await (await getAlarms(jsonRequest("GET", "/api/v1/alarms?status=active&pageSize=500"))).json();
        return body.items.find((a: { siteCode: string }) => a.siteCode === site).vip;
      };
      expect(await vipOf()).toBe(false);
      await putSite(jsonRequest("PUT", `/api/v1/site-master/${site}`, { vip: true }), { params: { code: site } });
      expect(await vipOf()).toBe(true);
    });
  });

  describe("/hourly-normalizations (FR-68)", () => {
    const rules = [
      { field: "*", from: "KAFR EL DAWAR", to: "KAFR ELDAWAR" },
      { field: "alarmName", from: "NE IS DISCONNECTED", to: "NE DISCONNECTED" },
    ];

    it("ADMIN replaces and reads the rules", async () => {
      const put = await putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules }));
      expect(put.status).toBe(200);
      const res = await getNormalizations(jsonRequest("GET", "/api/v1/hourly-normalizations"));
      expect((await res.json()).rules).toEqual(rules);
      await putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules: [rules[0]] }));
      expect(await db.hourlyNormalization.count()).toBe(1);
    });

    it("400 for an unknown field, an empty from, a repeated (field, from) or more than 500 rules", async () => {
      const bad = [
        [{ field: "battery", from: "A", to: "B" }],
        [{ field: "*", from: "", to: "B" }],
        [rules[0], rules[0]],
        Array.from({ length: 501 }, (_, i) => ({ field: "*", from: `A${i}`, to: "B" })),
      ];
      for (const r of bad) expect((await putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules: r }))).status).toBe(400);
    });

    it("403 for an OPERATOR (GET and PUT)", async () => {
      await as("OPERATOR");
      expect((await getNormalizations(jsonRequest("GET", "/api/v1/hourly-normalizations"))).status).toBe(403);
      expect((await putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules }))).status).toBe(403);
    });
  });

  describe("GET /hourly-reference (OPERATOR, ETag = referenceUpdatedAt)", () => {
    const etagOf = (res: Response) => res.headers.get("ETag")!;
    const reference = (etag?: string) =>
      getReference(new Request("http://localhost/api/v1/hourly-reference", { headers: etag ? { "If-None-Match": etag } : {} }));

    it("returns Site Master and normalizations with an ETag; 304 when unchanged", async () => {
      await importSites(upload(workbook()));
      await putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules: [{ field: "*", from: "A", to: "B" }] }));
      await as("OPERATOR");
      const res = await reference();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.siteMaster).toHaveLength(136);
      expect(body.normalizations).toEqual([{ field: "*", from: "A", to: "B" }]);
      expect(etagOf(res)).toBe(`"${body.updatedAt}"`);
      expect((await reference(etagOf(res))).status).toBe(304);
    });

    it("a new ETag after an import, an edit or a normalization change", async () => {
      await db.siteMaster.create({ data: { code: "0444DE", office: "X" } });
      const changes = [
        () => importSites(upload(workbook())),
        () => putSite(jsonRequest("PUT", "/api/v1/site-master/0444DE", { vip: true }), { params: { code: "0444DE" } }),
        () => putNormalizations(jsonRequest("PUT", "/api/v1/hourly-normalizations", { rules: [] })),
      ];
      let etag = etagOf(await reference());
      for (const change of changes) {
        await new Promise((r) => setTimeout(r, 5));
        expect((await change()).status).toBe(200);
        const res = await reference(etag);
        expect(res.status).toBe(200);
        expect(etagOf(res)).not.toBe(etag);
        etag = etagOf(res);
      }
    });

    it("403 for a VIEWER", async () => {
      await as("VIEWER");
      expect((await reference()).status).toBe(403);
    });
  });
});
