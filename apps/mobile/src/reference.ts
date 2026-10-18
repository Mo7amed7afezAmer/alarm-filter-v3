// P7-T05: Site Master (FR-55, FR-66) and hourly normalizations (FR-56, FR-68) for on-device
// processing, kept in expo-sqlite and revalidated by updatedAt (ETag) at most every 30 minutes,
// like the browser's IndexedDB cache (apps/web/lib/hourly/reference.ts). After the first sync the
// stored copy is used whenever the server cannot be reached.
import { ApiError, UnauthorizedError, type ApiClient } from "./api";
import type { Reference } from "./hourly";

/** OPERATOR (G-T15). */
export const REFERENCE_PATH = "/api/v1/hourly-reference";
/** HOURLY_CACHE_MIN (30 min), as on the web: no request at all within this time of the last check. */
export const REFERENCE_TTL_MS = 30 * 60_000;

export interface ReferenceEntry {
  etag: string | null;
  checkedAt: number;
  data: Reference;
}

export interface ReferenceStore {
  read(): Promise<ReferenceEntry | null>;
  write(entry: ReferenceEntry): Promise<void>;
  touch(checkedAt: number): Promise<void>;
}

type Param = string | number | null;

/** The part of expo-sqlite's `SQLiteDatabase` used here. */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: Param[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reference_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_master (pos INTEGER PRIMARY KEY NOT NULL, code TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hourly_normalizations (pos INTEGER PRIMARY KEY NOT NULL, data TEXT NOT NULL);
`;

/** One row per Site Master record and per normalization rule, in the server's order, plus etag /
 * checkedAt / updatedAt. */
export function sqliteReferenceStore(open: () => Promise<SqlDb>): ReferenceStore {
  let ready: Promise<SqlDb> | null = null;
  const db = () =>
    (ready ??= open().then(async (d) => {
      await d.execAsync(SCHEMA);
      return d;
    }));
  const setMeta = (d: SqlDb, key: string, value: string) =>
    d.runAsync("INSERT OR REPLACE INTO reference_meta (key, value) VALUES (?, ?)", key, value);

  return {
    async read() {
      const d = await db();
      const meta = new Map(
        (await d.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM reference_meta")).map((m) => [m.key, m.value]),
      );
      const updatedAt = meta.get("updatedAt");
      if (updatedAt === undefined) return null;
      const sites = await d.getAllAsync<{ data: string }>("SELECT data FROM site_master ORDER BY pos");
      const rules = await d.getAllAsync<{ data: string }>("SELECT data FROM hourly_normalizations ORDER BY pos");
      return {
        etag: meta.get("etag") || null,
        checkedAt: Number(meta.get("checkedAt") ?? 0),
        data: {
          updatedAt,
          siteMaster: sites.map((s) => JSON.parse(s.data) as Reference["siteMaster"][number]),
          normalizations: rules.map((r) => JSON.parse(r.data) as Reference["normalizations"][number]),
        },
      };
    },
    async write(e) {
      const d = await db();
      await d.withTransactionAsync(async () => {
        await d.runAsync("DELETE FROM site_master");
        await d.runAsync("DELETE FROM hourly_normalizations");
        for (const [i, s] of e.data.siteMaster.entries()) {
          await d.runAsync("INSERT INTO site_master (pos, code, data) VALUES (?, ?, ?)", i, s.code, JSON.stringify(s));
        }
        for (const [i, r] of e.data.normalizations.entries()) {
          await d.runAsync("INSERT INTO hourly_normalizations (pos, data) VALUES (?, ?)", i, JSON.stringify(r));
        }
        await setMeta(d, "etag", e.etag ?? "");
        await setMeta(d, "checkedAt", String(e.checkedAt));
        await setMeta(d, "updatedAt", e.data.updatedAt);
      });
    },
    async touch(checkedAt) {
      await setMeta(await db(), "checkedAt", String(checkedAt));
    },
  };
}

export class ReferenceSync {
  private pending: Promise<Reference> | null = null;

  constructor(
    private readonly api: Pick<ApiClient, "request">,
    private readonly store: ReferenceStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** One sync at a time: callers that arrive while a sync runs share it. */
  load(): Promise<Reference> {
    this.pending ??= this.sync().finally(() => (this.pending = null));
    return this.pending;
  }

  private async sync(): Promise<Reference> {
    const now = this.now();
    const cached = await this.store.read();
    if (cached && now - cached.checkedAt < REFERENCE_TTL_MS) return cached.data;

    let res: Response;
    try {
      res = await this.api.request(REFERENCE_PATH, { headers: cached?.etag ? { "If-None-Match": cached.etag } : {} });
    } catch (err) {
      if (err instanceof UnauthorizedError || !cached) throw err;
      if (err instanceof ApiError && err.status === 304) await this.store.touch(now);
      // Offline or a server error: keep working with the stored copy.
      return cached.data;
    }
    const data = (await res.json()) as Reference;
    await this.store.write({ etag: res.headers.get("ETag"), checkedAt: now, data });
    return data;
  }
}
