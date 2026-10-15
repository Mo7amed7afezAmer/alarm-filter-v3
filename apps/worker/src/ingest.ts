import { insertRawMessages, knownGmailIds, type NewRawMessage, type PrismaClient } from "@alarm/db";
import {
  currentHistoryId,
  getMessage,
  historySince,
  isQuotaError,
  listSince,
  type FetchedMessage,
  type GmailApi,
} from "./gmail";

/** NFR-03: concurrent `messages.get` calls. */
export const FETCH_CONCURRENCY = 5;

/** Where fetched messages go: `raw_messages` in production. */
export interface RawMessageSink {
  /** FR-04: which of these ids are already stored. */
  knownIds(ids: string[]): Promise<Set<string>>;
  /** FR-04 / NFR-11: insert, skipping duplicates; returns the number inserted. */
  insert(rows: NewRawMessage[]): Promise<number>;
}

export function dbSink(db: PrismaClient): RawMessageSink {
  return {
    knownIds: (ids) => knownGmailIds(db, ids),
    insert: (rows) => insertRawMessages(db, rows),
  };
}

export class MemorySink implements RawMessageSink {
  rows: NewRawMessage[] = [];
  async knownIds(ids: string[]): Promise<Set<string>> {
    const stored = new Set(this.rows.map((r) => r.gmailId));
    return new Set(ids.filter((id) => stored.has(id)));
  }
  async insert(rows: NewRawMessage[]): Promise<number> {
    const known = await this.knownIds(rows.map((r) => r.gmailId));
    const fresh = rows.filter((r) => !known.has(r.gmailId));
    this.rows.push(...fresh);
    return fresh.length;
  }
}

export interface IngestOptions {
  /** `system_status.lastHistoryId`. */
  lastHistoryId: string | null;
  /** The selected office differs from the label last synced. */
  officeChanged: boolean;
  /** The office label being read. */
  label: { id: string; name: string };
  /** Office tag stored on every raw message (FR-06, FR-23). */
  office: string;
  now: Date;
  backfillHours: number;
  maxPerRun: number;
  query: string;
}

export interface IngestResult {
  mode: "history" | "backfill";
  /** New ids found but left for a later cycle. */
  backlog: number;
  fetched: number;
  skipped: number;
  inserted: number;
  throttled: boolean;
  /** The historyId to store, or null to keep the current one (FR-05, NFR-12). */
  nextHistoryId: string | null;
}

/** FR-06: fetch with bounded concurrency; a quota error stops fetching and keeps what was fetched. */
async function fetchAll(gmail: GmailApi, ids: string[]) {
  const fetched: FetchedMessage[] = [];
  let skipped = 0;
  let throttled = false;
  let failure: unknown = null;
  let next = 0;

  async function worker() {
    while (!throttled && failure === null && next < ids.length) {
      const id = ids[next++]!;
      try {
        const msg = await getMessage(gmail, id);
        if (msg) fetched.push(msg);
        else skipped++;
      } catch (err) {
        if (isQuotaError(err)) throttled = true;
        else failure ??= err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, worker));
  if (failure !== null) throw failure;

  const order = new Map(ids.map((id, i) => [id, i]));
  fetched.sort((a, b) => order.get(a.gmailId)! - order.get(b.gmailId)!);
  return { fetched, skipped, throttled };
}

/** One ingestion pass: discover (FR-02/FR-03), skip known (FR-04), cap (FR-05), fetch and store (FR-06). */
export async function ingestOnce(gmail: GmailApi, sink: RawMessageSink, opts: IngestOptions): Promise<IngestResult> {
  let mode: IngestResult["mode"] = "backfill";
  let ids: string[] = [];
  let latestHistoryId = "";

  if (opts.lastHistoryId && !opts.officeChanged) {
    const history = await historySince(gmail, opts.lastHistoryId, opts.label.id);
    if (history !== "expired") {
      mode = "history";
      ids = history.ids;
      latestHistoryId = history.historyId;
    }
  }
  if (mode === "backfill") {
    latestHistoryId = await currentHistoryId(gmail);
    const after = new Date(opts.now.getTime() - opts.backfillHours * 3600_000);
    ids = await listSince(gmail, { after, labelName: opts.label.name, query: opts.query });
  }

  const known = await sink.knownIds(ids);
  const fresh = ids.filter((id) => !known.has(id));
  const batch = fresh.slice(0, opts.maxPerRun);
  const backlog = fresh.length - batch.length;

  const { fetched, skipped, throttled } = await fetchAll(gmail, batch);
  const inserted = await sink.insert(
    fetched.map((m) => ({ gmailId: m.gmailId, subject: m.subject, receivedAt: m.receivedAt, body: m.body, office: opts.office })),
  );

  return {
    mode,
    backlog,
    fetched: fetched.length,
    skipped,
    inserted,
    throttled,
    nextHistoryId: backlog === 0 && !throttled ? latestHistoryId : null,
  };
}
