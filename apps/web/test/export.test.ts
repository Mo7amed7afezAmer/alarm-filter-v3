import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { GET } from "@/app/api/v1/export/route";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, jsonRequest, testDatabaseUrl } from "./db";
import { expectedExports, NOW, seedAlarms } from "./fixtures";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

// FR-35 / NFR-09 / NFR-29: XLSX export compared cell by cell with samples/export/expected-exports.json.
describe.skipIf(!testDatabaseUrl)("GET /api/v1/export", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAlarms(db);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await clearUsers(db);
    await db.systemStatus.deleteMany();
    const me = await createUser(db, "viewer@noc.test", "VIEWER");
    session.mockResolvedValue({ id: me.id, email: me.email, role: "VIEWER" });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  it.each(expectedExports.map((e) => [e.name, e] as const))("%s matches the golden cells", async (_name, e) => {
    await db.systemStatus.create({ data: { id: 1, officeLabel: e.office } });
    const res = await GET(jsonRequest("GET", `/api/v1/export?${e.query}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="alarms-(active|cleared)-\d{8}-\d{4}\.xlsx"$/);

    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    expect(wb.SheetNames).toEqual([e.sheet]);
    const cells = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[e.sheet]!, { header: 1, defval: null, raw: true });
    expect(cells).toEqual(e.cells);
  });

  it("ignores page and pageSize (exports every matching row)", async () => {
    const e = expectedExports.find((x) => x.name === "active-dn")!;
    await db.systemStatus.create({ data: { id: 1, officeLabel: e.office } });
    const res = await GET(jsonRequest("GET", `/api/v1/export?${e.query}&page=2&pageSize=1`));
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    expect(XLSX.utils.sheet_to_json(wb.Sheets[e.sheet]!, { header: 1 })).toHaveLength(e.cells.length);
  });

  it("400 for an invalid status or date", async () => {
    await db.systemStatus.create({ data: { id: 1, officeLabel: "DN/Kafr ElDawar" } });
    expect((await GET(jsonRequest("GET", "/api/v1/export?status=all"))).status).toBe(400);
    expect((await GET(jsonRequest("GET", "/api/v1/export?status=cleared&from=2026-02-30"))).status).toBe(400);
  });

  it("413 above 50,000 rows (NFR-09)", async () => {
    const office = "DN/Big Office";
    const t = new Date("2026-10-11T10:00:00Z");
    const rows = Array.from({ length: 50_001 }, (_, i) => ({
      alarmKey: `BULK||SITE_${i}`,
      alarmName: "BULK",
      site: `SITE_${i}`,
      category: "OTHER" as const,
      alarmTime: t,
      office,
    }));
    for (let i = 0; i < rows.length; i += 10_000) await db.alarm.createMany({ data: rows.slice(i, i + 10_000) });
    await db.systemStatus.create({ data: { id: 1, officeLabel: office } });

    const res = await GET(jsonRequest("GET", "/api/v1/export?status=active"));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("TOO_MANY_ROWS");
    await db.alarm.deleteMany({ where: { office } });
  }, 180_000); // inserting 50,001 rows is slow on a busy machine
});
