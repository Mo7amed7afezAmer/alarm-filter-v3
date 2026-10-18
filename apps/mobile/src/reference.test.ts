import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { NormalizationRule, SiteMasterRecord } from "@alarm/core";
import initSqlJs, { type Database } from "sql.js";
import { describe, expect, it, vi } from "vitest";
import { ApiError, UnauthorizedError } from "./api";
import type { Reference } from "./hourly";
import { REFERENCE_PATH, REFERENCE_TTL_MS, ReferenceSync, sqliteReferenceStore, type ReferenceStore, type SqlDb } from "./reference";

const samples = new URL("../../../samples/hourly/", import.meta.url);
const siteMaster = JSON.parse(readFileSync(new URL("site-master.json", samples), "utf8")) as SiteMasterRecord[];
const normalizations: NormalizationRule[] = [
  { field: "alarmName", from: "MAINS FAIL", to: "MAIN POWER FAIL" },
  { field: "*", from: "BTS", to: "SITE" },
];
const v1: Reference = { updatedAt: "2026-10-17T00:00:00.000Z", siteMaster, normalizations };
const v2: Reference = { updatedAt: "2026-10-18T00:00:00.000Z", siteMaster: siteMaster.slice(0, 10), normalizations: [] };

const SQL = await initSqlJs({ locateFile: (f) => createRequire(import.meta.url).resolve(`sql.js/dist/${f}`) });

/** expo-sqlite's async API over sql.js (real SQLite, compiled to WASM). */
function sqlDb(db: Database): SqlDb {
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, ...params) => void db.run(sql, params),
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) => {
      const st = db.prepare(sql);
      st.bind(params);
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      st.free();
      return out;
    },
    withTransactionAsync: async (task) => {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

const ok = (data: Reference) => new Response(JSON.stringify(data), { headers: { ETag: `"${data.updatedAt}"` } });

function setup(store: ReferenceStore = sqliteReferenceStore(async () => sqlDb(new SQL.Database()))) {
  let t = 1_000_000;
  const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
  const sync = new ReferenceSync({ request }, store, () => t);
  return { sync, request, store, advance: (ms: number) => (t += ms) };
}

const etagSent = (init?: RequestInit) => new Headers(init?.headers).get("If-None-Match");

// P7-T05: Site Master + normalizations (FR-56, FR-66, FR-68) kept in expo-sqlite and synced by
// updatedAt (ETag / If-None-Match), like the web's IndexedDB cache (G-T14).
describe("hourly reference data in SQLite (P7-T05)", () => {
  it("first sync downloads /hourly-reference without If-None-Match and stores it", async () => {
    const { sync, request, store } = setup();
    request.mockResolvedValueOnce(ok(v1));
    expect(await sync.load()).toEqual(v1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe(REFERENCE_PATH);
    expect(etagSent(request.mock.calls[0]![1])).toBeNull();
    expect((await store.read())?.data).toEqual(v1);
  });

  it("makes no request within 30 minutes of the last check", async () => {
    const { sync, request, advance } = setup();
    request.mockResolvedValueOnce(ok(v1));
    await sync.load();
    advance(REFERENCE_TTL_MS - 1);
    expect(await sync.load()).toEqual(v1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("after 30 minutes revalidates with the stored ETag; 304 keeps the data and restarts the 30 minutes", async () => {
    const { sync, request, advance } = setup();
    request.mockResolvedValueOnce(ok(v1));
    await sync.load();
    advance(REFERENCE_TTL_MS);
    request.mockRejectedValueOnce(new ApiError(304, "HTTP_ERROR", "request failed (304)"));
    expect(await sync.load()).toEqual(v1);
    expect(etagSent(request.mock.calls[1]![1])).toBe(`"${v1.updatedAt}"`);
    advance(REFERENCE_TTL_MS - 1);
    await sync.load();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a newer updatedAt replaces both tables (removed sites and rules are gone)", async () => {
    const { sync, request, store, advance } = setup();
    request.mockResolvedValueOnce(ok(v1));
    await sync.load();
    advance(REFERENCE_TTL_MS);
    request.mockResolvedValueOnce(ok(v2));
    expect(await sync.load()).toEqual(v2);
    expect((await store.read())?.data).toEqual(v2);
  });

  it("works offline after the first sync: network errors and server errors return the stored data", async () => {
    const { sync, request, advance } = setup();
    request.mockResolvedValueOnce(ok(v1));
    await sync.load();
    advance(REFERENCE_TTL_MS);
    request.mockRejectedValueOnce(new TypeError("Network request failed"));
    expect(await sync.load()).toEqual(v1);
    request.mockRejectedValueOnce(new ApiError(503, "HTTP_ERROR", "request failed (503)"));
    expect(await sync.load()).toEqual(v1);
  });

  it("without a first sync, offline is an error", async () => {
    const { sync, request } = setup();
    request.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(sync.load()).rejects.toThrow("Network request failed");
  });

  it("a 401 is passed on (the app signs out), even with stored data", async () => {
    const { sync, request, advance } = setup();
    request.mockResolvedValueOnce(ok(v1));
    await sync.load();
    advance(REFERENCE_TTL_MS);
    request.mockRejectedValueOnce(new UnauthorizedError("session expired"));
    await expect(sync.load()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("callers that arrive while a sync runs share it", async () => {
    const { sync, request } = setup();
    request.mockResolvedValueOnce(ok(v1));
    const [a, b] = await Promise.all([sync.load(), sync.load()]);
    expect(a).toEqual(v1);
    expect(b).toEqual(v1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("is kept in SQLite tables and survives an app restart (new store on the same database file), offline", async () => {
    const file = new SQL.Database();
    const first = setup(sqliteReferenceStore(async () => sqlDb(file)));
    first.request.mockResolvedValueOnce(ok(v1));
    await first.sync.load();

    const tables = file.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]!.values.flat();
    expect(tables).toEqual(["hourly_normalizations", "reference_meta", "site_master"]);
    expect(file.exec("SELECT COUNT(*) FROM site_master")[0]!.values[0]![0]).toBe(siteMaster.length);
    expect(file.exec("SELECT COUNT(*) FROM hourly_normalizations")[0]!.values[0]![0]).toBe(2);

    const reopened = new SQL.Database(file.export());
    const second = setup(sqliteReferenceStore(async () => sqlDb(reopened)));
    second.advance(REFERENCE_TTL_MS);
    second.request.mockRejectedValue(new TypeError("Network request failed"));
    const data = await second.sync.load();
    expect(data.siteMaster).toEqual(siteMaster);
    expect(data.normalizations).toEqual(normalizations);
    expect(data.updatedAt).toBe(v1.updatedAt);
  });
});
