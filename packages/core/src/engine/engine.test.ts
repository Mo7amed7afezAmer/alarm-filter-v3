import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_RULES } from "@alarm/db";
import { describe, expect, it, vi } from "vitest";
import { MemoryStore, processBatch, reprocess, type NewRawMessage } from "./index";

// Cases derived from samples/subjects.txt and samples/bodies.jsonl (approved 2026-10-15).
const casesDir = fileURLToPath(new URL("../../../../samples/engine", import.meta.url));

interface CaseMessage {
  gmailId: string;
  subject: string;
  receivedAt: string;
  body: string | null;
  office: string | null;
}
interface Case {
  name: string;
  batches: CaseMessage[][];
  expected: unknown;
}

const cases: Case[] = readdirSync(casesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => {
    const messages = JSON.parse(readFileSync(join(casesDir, name, "messages.json"), "utf8")) as { batches: CaseMessage[][] };
    const expected = JSON.parse(readFileSync(join(casesDir, name, "expected-alarms.json"), "utf8")) as unknown;
    return { name, batches: messages.batches, expected };
  });

const toRaw = (m: CaseMessage): NewRawMessage => ({ ...m, receivedAt: new Date(m.receivedAt) });
const opts = { rules: SEED_RULES };

/** Runs a case batch by batch, as the worker would cycle by cycle. */
async function run(c: Case, options: Parameters<typeof processBatch>[1] = opts): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const batch of c.batches) {
    await store.insertRawMessages(batch.map(toRaw));
    await processBatch(store, options);
  }
  return store;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Same shape as expected-alarms.json. */
function snapshot(store: MemoryStore) {
  const alarms = [...store.alarms].sort(
    (a, b) =>
      a.alarmTime.getTime() - b.alarmTime.getTime() ||
      cmp(a.alarmKey, b.alarmKey) ||
      cmp(a.consecNbr ?? "", b.consecNbr ?? ""),
  );
  const orphans = [...store.orphanClears].sort(
    (a, b) => a.clearTime.getTime() - b.clearTime.getTime() || cmp(a.subject, b.subject),
  );
  const raws = [...store.rawMessages].sort((a, b) => cmp(a.gmailId, b.gmailId));
  return {
    alarms: alarms.map((a) => ({
      alarmKey: a.alarmKey,
      alarmName: a.alarmName,
      site: a.site,
      category: a.category,
      alarmTime: iso(a.alarmTime),
      status: a.status,
      clearTime: iso(a.clearTime),
      durationMin: a.durationMin,
      clearType: a.clearType,
      consecNbr: a.consecNbr,
      cellName: a.cellName,
      device: a.device,
      office: a.office,
    })),
    orphanClears: orphans.map((o) => ({
      alarmKey: o.alarmKey,
      subject: o.subject,
      clearTime: iso(o.clearTime),
      consecNbr: o.consecNbr,
      office: o.office,
    })),
    rawMessages: raws.map((r) => ({ gmailId: r.gmailId, processed: r.processedAt !== null, parseError: r.parseError })),
  };
}

describe("samples/engine (FR-15, FR-18…FR-23)", () => {
  it("has the 32 approved cases", () => {
    expect(cases).toHaveLength(32);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect(snapshot(await run(c))).toEqual(c.expected);
  });
});

describe("reprocess (FR-24, NFR-13)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s: reprocess twice → identical alarms", async (_name, c) => {
    const store = await run(c);
    const since = new Date(Math.min(...c.batches.flat().map((m) => Date.parse(m.receivedAt))));

    await reprocess(store, since, opts);
    const first = snapshot(store);
    await reprocess(store, since, opts);

    expect(snapshot(store)).toEqual(first);
    expect(first.rawMessages.every((r) => r.processed)).toBe(true);
  });
});

describe("reprocess keeps createdAt of recreated alarms (G-T11, fixes gap 23)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    vi.useFakeTimers({ now: new Date("2026-10-11T19:00:00Z"), toFake: ["Date"] });
    try {
      const store = await run(c);
      const before = new Map(store.alarms.map((a) => [a.consecNbr ?? `${a.alarmKey}|${a.alarmTime.toISOString()}`, a.createdAt.getTime()]));
      const since = new Date(Math.min(...c.batches.flat().map((m) => Date.parse(m.receivedAt))));

      vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
      await reprocess(store, since, opts);

      for (const a of store.alarms) {
        const key = a.consecNbr ?? `${a.alarmKey}|${a.alarmTime.toISOString()}`;
        expect(a.createdAt.getTime(), key).toBe(before.get(key) ?? Date.parse("2026-10-12T08:00:00Z"));
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("global matching across offices (D-05)", () => {
  const crossOffice = cases.find((c) => c.name === "x04-cross-office-match")!;

  it("a Clear read under another office closes the alarm", async () => {
    const store = await run(crossOffice);
    expect(store.alarms).toHaveLength(1);
    expect(store.alarms[0]).toMatchObject({ status: "CLEARED", clearType: "EMAIL", office: "DN" });
  });

  it("logs a line when the Clear's office differs from the alarm's office", async () => {
    const log = vi.fn();
    await run(crossOffice, { ...opts, log });
    const lines = log.mock.calls.map((args) => String(args[0]));
    expect(lines.some((l) => l.includes("DN") && l.includes("DS"))).toBe(true);
  });

  it("logs nothing about offices when they are the same", async () => {
    const log = vi.fn();
    await run(cases.find((c) => c.name === "e01-alarm-then-clear")!, { ...opts, log });
    expect(log).not.toHaveBeenCalled();
  });
});
