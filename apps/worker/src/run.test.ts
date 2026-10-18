import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@alarm/db";
import type { WorkerConfig } from "./config";
import type { GmailApi } from "./gmail";
import type { LabelDirectory } from "./labels";
import { CYCLE_MAX_WAIT_MS, CYCLE_TIMEOUT_MS, REPROCESS_TIMEOUT_MS, runCycle, summaryLine, type RunDeps, type RunResult } from "./run";

// No database: the engine, ingestion and status helpers are replaced; $transaction is a spy.
const outcomes = {
  created: 0,
  created_superseded: 0,
  duplicate: 0,
  orphan_consumed: 0,
  cleared: 0,
  stale_clear: 0,
  orphan: 0,
  ignored_format: 0,
  parse_error: 0,
};
const status = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@alarm/core", () => ({
  processBatch: vi.fn(async () => ({ ...outcomes, created: 3, cleared: 2, orphan: 1 })),
  reprocess: vi.fn(async () => undefined),
}));
vi.mock("./engine-store", () => ({ prismaEngineStore: vi.fn(() => ({})) }));
vi.mock("./ingest", () => ({
  dbSink: vi.fn(() => ({})),
  ingestOnce: vi.fn(async () => ({
    mode: "history",
    fetched: 7,
    skipped: 1,
    inserted: 6,
    backlog: 4,
    throttled: false,
    nextHistoryId: "99",
  })),
}));
vi.mock("./status", () => ({
  getStatus: vi.fn(async () => status.value),
  updateStatus: vi.fn(async () => undefined),
  recordError: vi.fn(async () => undefined),
}));

function deps(log = vi.fn()) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ locked: true }]),
    rule: { findMany: vi.fn(async () => []) },
    systemStatus: { update: vi.fn(async () => undefined) },
  };
  const $transaction = vi.fn<(fn: (t: typeof tx) => unknown, opts?: unknown) => Promise<unknown>>(async (fn) => fn(tx));
  const d: RunDeps = {
    gmail: {} as GmailApi,
    db: { $transaction } as unknown as PrismaClient,
    config: {
      gmailLabels: ["Cairo"],
      alarmTz: "Africa/Cairo",
      initialBackfillHours: 24,
      maxMessagesPerRun: 500,
      gmailQuery: "",
    } as unknown as WorkerConfig,
    labels: { refresh: vi.fn(async () => null), idOf: vi.fn(async () => "Label_1") } as unknown as LabelDirectory,
    now: () => new Date("2026-10-11T19:00:00Z"),
    log,
  };
  return { d, $transaction, log };
}

beforeEach(() => {
  status.value = { reprocessDays: null, officeLabel: null, syncedLabel: "Cairo", lastHistoryId: "10" };
});

describe("NFR-04 transaction timeouts", () => {
  it("NFR-04: processing transaction timeout is 5 min with maxWait 60 s; reprocess timeout is 30 min", () => {
    expect(CYCLE_TIMEOUT_MS).toBe(300_000);
    expect(CYCLE_MAX_WAIT_MS).toBe(60_000);
    expect(REPROCESS_TIMEOUT_MS).toBe(1_800_000);
  });

  it("NFR-04: the processing transaction is opened with timeout 5 min and maxWait 60 s", async () => {
    const { d, $transaction } = deps();
    await runCycle(d);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0]![1]).toEqual({ timeout: 300_000, maxWait: 60_000 });
  });

  it("NFR-04: the reprocess transaction is opened with timeout 30 min, then processing with 5 min", async () => {
    status.value = { ...status.value, reprocessDays: 2 };
    const { d, $transaction } = deps();
    await runCycle(d);
    expect($transaction).toHaveBeenCalledTimes(2);
    expect($transaction.mock.calls[0]![1]).toEqual({ timeout: 1_800_000, maxWait: 60_000 });
    expect($transaction.mock.calls[1]![1]).toEqual({ timeout: 300_000, maxWait: 60_000 });
  });
});

describe("NFR-35 per-cycle summary line", () => {
  it("NFR-35: logs exactly one summary line per cycle with office, mode, fetched, backlog and outcome counts", async () => {
    const { d, log } = deps();
    await runCycle(d);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(line).not.toContain("\n");
    expect(line).toContain("office=Cairo");
    expect(line).toContain("mode=history");
    expect(line).toContain("fetched=7");
    expect(line).toContain("backlog=4");
    expect(line).toContain("created=3");
    expect(line).toContain("cleared=2");
    expect(line).toContain("orphan=1");
  });

  it("NFR-35: a cycle skipped because lock 42 is held also logs one line", async () => {
    const { d, log } = deps();
    const $transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn({ $queryRaw: vi.fn(async () => [{ locked: false }]) }));
    await runCycle({ ...d, db: { $transaction } as unknown as PrismaClient });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("skipped");
  });

  it("NFR-35: one line per cycle across consecutive cycles", async () => {
    const { d, log } = deps();
    await runCycle(d);
    await runCycle(d);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("NFR-35: summaryLine formats office, mode, fetched, backlog and the non-zero outcome counts", () => {
    const r: RunResult = {
      outcome: "ran",
      office: "Alex",
      reprocessed: false,
      processed: { ...outcomes, duplicate: 5, stale_clear: 1 },
      mode: "backfill",
      fetched: 12,
      skipped: 0,
      inserted: 12,
      backlog: 0,
      throttled: false,
    };
    expect(summaryLine(r)).toBe("cycle: office=Alex mode=backfill fetched=12 backlog=0 duplicate=5 stale_clear=1");
    expect(summaryLine({ ...r, processed: { ...outcomes } })).toBe("cycle: office=Alex mode=backfill fetched=12 backlog=0 no changes");
  });
});
