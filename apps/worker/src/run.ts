import { processBatch, reprocess, type Outcomes } from "@alarm/core";
import type { Db, PrismaClient } from "@alarm/db";
import type { WorkerConfig } from "./config";
import { prismaEngineStore } from "./engine-store";
import type { GmailApi } from "./gmail";
import { dbSink, ingestOnce, type IngestResult } from "./ingest";
import type { LabelDirectory } from "./labels";
import { getStatus, recordError, updateStatus } from "./status";
import type { Log } from "./ticker";

/** NFR-10: advisory lock id. */
export const LOCK_ID = 42;
/** NFR-04: processing transaction timeout and wait. */
export const CYCLE_TIMEOUT_MS = 5 * 60_000;
export const CYCLE_MAX_WAIT_MS = 60_000;
/** FR-24: reprocess transaction timeout. */
export const REPROCESS_TIMEOUT_MS = 30 * 60_000;

export interface RunDeps {
  gmail: GmailApi;
  db: PrismaClient;
  config: WorkerConfig;
  labels: LabelDirectory;
  now?: () => Date;
  log: Log;
}

export type RunResult =
  | { outcome: "locked" }
  | ({
      outcome: "ran";
      office: string;
      reprocessed: boolean;
      processed: Outcomes;
    } & Pick<IngestResult, "mode" | "fetched" | "skipped" | "inserted" | "backlog" | "throttled">);

/**
 * D-03 / NFR-10: take advisory lock 42 for this transaction; a second instance gets `false`
 * and skips the cycle.
 */
async function tryLock(tx: Db): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_ID}::bigint) AS locked`;
  return rows[0]?.locked === true;
}

const rulesOf = (tx: Db) => tx.rule.findMany({ select: { pattern: true, category: true, priority: true } });

/** One ingestion cycle (FR-01 … FR-09, FR-24). Errors are recorded in system_status and rethrown. */
export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const { gmail, db, config, labels, log } = deps;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const status = await getStatus(db);
    const engineOpts = { tz: config.alarmTz, log };
    let reprocessed = false;

    // FR-24: an ADMIN-requested reprocess runs first, inside its own locked transaction.
    if (status.reprocessDays) {
      const since = new Date(now.getTime() - status.reprocessDays * 86_400_000);
      const ran = await db.$transaction(
        async (tx) => {
          if (!(await tryLock(tx))) return false;
          await reprocess(prismaEngineStore(tx), since, { ...engineOpts, rules: await rulesOf(tx) });
          await tx.systemStatus.update({ where: { id: 1 }, data: { reprocessDays: null } });
          return true;
        },
        { timeout: REPROCESS_TIMEOUT_MS, maxWait: CYCLE_MAX_WAIT_MS },
      );
      if (!ran) {
        log(`cycle skipped: advisory lock ${LOCK_ID} is held by another instance`);
        return { outcome: "locked" };
      }
      reprocessed = true;
    }

    // FR-07: the selected office, else the first GMAIL_LABELS entry.
    const office = status.officeLabel ?? config.gmailLabels[0];
    if (!office) throw new Error("no office selected and GMAIL_LABELS is empty");

    // FR-08: refresh the available office labels at most every 10 minutes.
    const available = await labels.refresh(now);
    if (available) await updateStatus(db, { availableLabels: available });
    const labelId = await labels.idOf(office, now);

    const result = await db.$transaction(
      async (tx): Promise<RunResult> => {
        if (!(await tryLock(tx))) return { outcome: "locked" };
        const ingest = await ingestOnce(gmail, dbSink(tx), {
          lastHistoryId: status.lastHistoryId,
          officeChanged: status.syncedLabel !== office,
          label: { id: labelId, name: office },
          office,
          now,
          backfillHours: config.initialBackfillHours,
          maxPerRun: config.maxMessagesPerRun,
          query: config.gmailQuery,
        });
        const processed = await processBatch(prismaEngineStore(tx), { ...engineOpts, rules: await rulesOf(tx) });
        // FR-09; FR-05: lastHistoryId moves only when drained and unthrottled.
        await tx.systemStatus.update({
          where: { id: 1 },
          data: {
            lastRunAt: now,
            lastRunMessages: ingest.inserted,
            lastError: null,
            syncedLabel: office,
            ...(ingest.nextHistoryId ? { lastHistoryId: ingest.nextHistoryId } : {}),
          },
        });
        return {
          outcome: "ran",
          office,
          reprocessed,
          processed,
          mode: ingest.mode,
          fetched: ingest.fetched,
          skipped: ingest.skipped,
          inserted: ingest.inserted,
          backlog: ingest.backlog,
          throttled: ingest.throttled,
        };
      },
      { timeout: CYCLE_TIMEOUT_MS, maxWait: CYCLE_MAX_WAIT_MS },
    );

    if (result.outcome === "locked") log(`cycle skipped: advisory lock ${LOCK_ID} is held by another instance`);
    return result;
  } catch (err) {
    await recordError(db, err, now).catch((e: unknown) => log(`could not record the error: ${String(e)}`));
    throw err;
  }
}

/** NFR-35: one summary line per cycle. */
export function summaryLine(r: RunResult): string {
  if (r.outcome === "locked") return "cycle: skipped (lock held)";
  const counts = Object.entries(r.processed)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  return (
    `cycle: office=${r.office} mode=${r.mode} fetched=${r.fetched} backlog=${r.backlog}` +
    `${r.throttled ? " throttled" : ""}${r.reprocessed ? " reprocessed" : ""} ${counts || "no changes"}`
  );
}
