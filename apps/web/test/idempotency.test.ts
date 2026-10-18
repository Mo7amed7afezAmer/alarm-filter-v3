import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { POST as reprocess } from "@/app/api/v1/reprocess/route";
import { PUT as putRules } from "@/app/api/v1/rules/route";
import { POST as importSites } from "@/app/api/v1/site-master/import/route";
import { idempotencyStore } from "@/lib/idempotency";
import { getSessionUser } from "@/lib/session";
import { clearUsers, createUser, freshDatabase, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const json = (method: string, url: string, body: unknown, key: string) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Code: "0101DE", Office: "DN/Idem" }]), "SiteMaster");
const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

/** A retry re-sends the same file in a new multipart body (new boundary). */
function siteMasterUpload(key: string): Request {
  const form = new FormData();
  form.append("file", new File([bytes], "SiteMaster.xlsx"));
  return new Request("http://localhost/api/v1/site-master/import", { method: "POST", headers: { "Idempotency-Key": key }, body: form });
}

// P3-T08: a replayed request returns the cached 2xx without re-executing. Each case changes the
// database between the two calls; an unchanged database after the replay proves nothing ran.
describe.skipIf(!testDatabaseUrl)("Idempotency-Key on the mutating routes (P3-T08)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  beforeEach(async () => {
    idempotencyStore.clear();
    await clearUsers(db);
    const admin = await createUser(db, "admin@noc.test", "ADMIN");
    session.mockResolvedValue({ id: admin.id, email: admin.email, role: "ADMIN" });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it("PUT /rules (FR-17)", async () => {
    const body = { rules: [{ pattern: "LINK FAILURE", category: "DOWN", priority: 10 }] };
    const first = await putRules(json("PUT", "/api/v1/rules", body, "rules-1"));
    expect(first.status).toBe(200);
    await db.rule.create({ data: { pattern: "ADDED LATER", category: "POWER", priority: 20 } });

    const again = await putRules(json("PUT", "/api/v1/rules", body, "rules-1"));
    expect(again.status).toBe(200);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
    expect(await db.rule.count()).toBe(2);
  });

  it("POST /reprocess (FR-24)", async () => {
    const first = await reprocess(json("POST", "/api/v1/reprocess", { days: 3 }, "rep-1"));
    expect(first.status).toBe(202);
    await db.systemStatus.update({ where: { id: 1 }, data: { reprocessDays: null } });

    const again = await reprocess(json("POST", "/api/v1/reprocess", { days: 3 }, "rep-1"));
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ reprocessDays: 3 });
    expect((await db.systemStatus.findUniqueOrThrow({ where: { id: 1 } })).reprocessDays).toBeNull();
  });

  it("POST /site-master/import (FR-65)", async () => {
    await db.siteMaster.deleteMany();
    const first = await importSites(siteMasterUpload("sm-1"));
    expect(first.status).toBe(200);
    const result = await first.json();
    await db.siteMaster.deleteMany();

    const again = await importSites(siteMasterUpload("sm-1"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(result);
    expect(await db.siteMaster.count()).toBe(0);
  });
});
