// G-T14: Site Master (FR-55) and hourly normalizations (FR-56) for client-side processing, cached in
// IndexedDB and revalidated by updatedAt (ETag) at most every 30 minutes (decided 2026-10-17).
// Browser-safe.
import type { NormalizationRule, SiteMasterRecord } from "@alarm/core";

/** Served by G-T15. */
export const REFERENCE_URL = "/api/v1/hourly-reference";
/** HOURLY_CACHE_MIN (30 min): no request at all within this time of the last check. */
export const REFERENCE_TTL_MS = 30 * 60_000;

export interface ReferenceData {
  updatedAt: string;
  siteMaster: SiteMasterRecord[];
  normalizations: NormalizationRule[];
}

interface Entry {
  etag: string | null;
  checkedAt: number;
  data: ReferenceData;
}

const DB = "noc-hourly";
const STORE = "reference";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const readEntry = () => tx<Entry | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<Entry | undefined>);
const writeEntry = (e: Entry) => tx("readwrite", (s) => s.put(e, KEY));

export async function clearReference(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY));
}

export interface LoadOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

let pending: Promise<ReferenceData> | null = null;

/** One load at a time: callers that arrive while a load runs share it. */
export function loadReference(opts: LoadOptions = {}): Promise<ReferenceData> {
  pending ??= load(opts).finally(() => (pending = null));
  return pending;
}

async function load(opts: LoadOptions): Promise<ReferenceData> {
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = (opts.now ?? Date.now)();
  const cached = await readEntry();
  if (cached && now - cached.checkedAt < REFERENCE_TTL_MS) return cached.data;

  let res: Response;
  try {
    res = await doFetch(REFERENCE_URL, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
      credentials: "same-origin",
    });
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
  if (res.status === 304 && cached) {
    await writeEntry({ ...cached, checkedAt: now });
    return cached.data;
  }
  if (!res.ok) {
    if (cached) return cached.data;
    throw new Error(`reference data could not be loaded (HTTP ${res.status})`);
  }
  const data = (await res.json()) as ReferenceData;
  await writeEntry({ etag: res.headers.get("ETag"), checkedAt: now, data });
  return data;
}
