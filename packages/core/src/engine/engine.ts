import { classify, type ClassifyRule } from "../classify";
import { DEFAULT_ALARM_TZ, parseMessage, parseSubject, type HashMessage, type ParsedMessage } from "../parser";
import type { Alarm, EngineStore, RawMessage } from "./store";

export interface EngineOptions {
  rules: readonly ClassifyRule[];
  /** `ALARM_TZ` (default Africa/Cairo). */
  tz?: string;
  /** Receives one line per notable event (D-05: Clear matched an alarm of another office). */
  log?: (line: string) => void;
  /** createdAt to give a recreated alarm (reprocess, G-T11); undefined = now. */
  createdAtFor?: (alarm: { consecNbr: string | null; alarmKey: string; alarmTime: Date }) => Date | undefined;
}

export type Outcome =
  | "created"
  | "created_superseded"
  | "duplicate"
  | "orphan_consumed"
  | "cleared"
  | "stale_clear"
  | "orphan"
  | "ignored_format"
  | "parse_error";

export type Outcomes = Record<Outcome, number>;

const emptyOutcomes = (): Outcomes => ({
  created: 0,
  created_superseded: 0,
  duplicate: 0,
  orphan_consumed: 0,
  cleared: 0,
  stale_clear: 0,
  orphan: 0,
  ignored_format: 0,
  parse_error: 0,
});

/** FR-21: `max(0, round((clearTime − alarmTime) / 60000))`. */
export function durationMinutes(alarmTime: Date, clearTime: Date): number {
  return Math.max(0, Math.round((clearTime.getTime() - alarmTime.getTime()) / 60000));
}

interface Item {
  raw: RawMessage;
  parsed: ParsedMessage;
}

/** FR-18: by alarmTime (receivedAt when absent), alarms before clears, then receivedAt, then gmailId. */
function compare(a: Item, b: Item): number {
  const time = (i: Item) => ("alarmTime" in i.parsed && i.parsed.alarmTime ? i.parsed.alarmTime : i.raw.receivedAt).getTime();
  const clear = (i: Item) => ("isClear" in i.parsed && i.parsed.isClear ? 1 : 0);
  return (
    time(a) - time(b) ||
    clear(a) - clear(b) ||
    a.raw.receivedAt.getTime() - b.raw.receivedAt.getTime() ||
    (a.raw.gmailId < b.raw.gmailId ? -1 : a.raw.gmailId > b.raw.gmailId ? 1 : 0)
  );
}

/** Processes every pending raw message (FR-13 … FR-23). */
export async function processBatch(store: EngineStore, opts: EngineOptions): Promise<Outcomes> {
  const tz = opts.tz ?? DEFAULT_ALARM_TZ;
  const items: Item[] = (await store.pendingRawMessages()).map((raw) => ({
    raw,
    parsed: parseMessage(raw.subject, raw.body, tz),
  }));
  items.sort(compare);

  const outcomes = emptyOutcomes();
  for (const { raw, parsed } of items) {
    let outcome: Outcome;
    if ("error" in parsed) {
      outcome = "parse_error"; // FR-14
      await store.markProcessed(raw.id, parsed.error);
      outcomes[outcome]++;
      continue;
    }
    if (parsed.format === "HUAWEI") {
      outcome = "ignored_format"; // FR-13
    } else if (parsed.isClear) {
      outcome = await handleClear(store, raw, parsed, opts);
    } else {
      outcome = await handleAlarm(store, raw, parsed, opts, tz);
    }
    await store.markProcessed(raw.id);
    outcomes[outcome]++;
  }
  return outcomes;
}

async function handleAlarm(store: EngineStore, raw: RawMessage, m: HashMessage, opts: EngineOptions, tz: string): Promise<Outcome> {
  const consecNbr = m.consecNbr ?? null;

  // FR-19: duplicate by consecNbr, or (no consecNbr) by key + time.
  if (consecNbr !== null) {
    if (await store.findAlarmByConsec(consecNbr)) return "duplicate";
  } else if (await store.findAlarm(m.alarmKey, m.alarmTime)) {
    return "duplicate";
  }

  const base = {
    alarmKey: m.alarmKey,
    alarmName: m.alarmName,
    site: m.site,
    category: classify(m.alarmName, opts.rules), // FR-15
    alarmTime: m.alarmTime,
    consecNbr,
    cellName: m.cellName ?? null,
    device: m.device ?? null,
    office: raw.office, // FR-23
    createdAt: opts.createdAtFor?.({ consecNbr, alarmKey: m.alarmKey, alarmTime: m.alarmTime }),
  };

  // FR-22: a stored Clear for this alarm (same consecNbr, or same key + subject time).
  const candidates = [
    ...(consecNbr !== null ? await store.findOrphanClears({ consecNbr }) : []),
    ...(await store.findOrphanClears({ alarmKey: m.alarmKey })).filter((o) => {
      const s = parseSubject(o.subject, tz);
      return "alarmTime" in s && s.alarmTime?.getTime() === m.alarmTime.getTime();
    }),
  ].sort((a, b) => a.clearTime.getTime() - b.clearTime.getTime() || a.id - b.id);
  const orphan = candidates[0];
  if (orphan) {
    await store.deleteOrphanClear(orphan.id);
    await store.createAlarm({
      ...base,
      status: "CLEARED",
      clearType: "EMAIL",
      clearTime: orphan.clearTime,
      durationMin: durationMinutes(m.alarmTime, orphan.clearTime),
    });
    return "orphan_consumed";
  }

  if (consecNbr === null) {
    // FR-20: body-less alarms of one key supersede each other; consecNbr alarms never take part.
    const bodyless = (await store.findActiveAlarms(m.alarmKey)).filter((a) => a.consecNbr === null);
    const newer = bodyless
      .filter((a) => a.alarmTime.getTime() > m.alarmTime.getTime())
      .sort((a, b) => a.alarmTime.getTime() - b.alarmTime.getTime())[0];
    if (newer) {
      await store.createAlarm({
        ...base,
        status: "CLEARED",
        clearType: "AUTO_SUPERSEDED",
        clearTime: newer.alarmTime,
        durationMin: durationMinutes(m.alarmTime, newer.alarmTime),
      });
      return "created_superseded";
    }
    for (const older of bodyless.filter((a) => a.alarmTime.getTime() < m.alarmTime.getTime())) {
      await store.updateAlarm(older.id, {
        status: "CLEARED",
        clearType: "AUTO_SUPERSEDED",
        clearTime: m.alarmTime,
        durationMin: durationMinutes(older.alarmTime, m.alarmTime),
      });
    }
  }

  await store.createAlarm({ ...base, status: "ACTIVE", clearTime: null, durationMin: null, clearType: null });
  return "created";
}

async function handleClear(store: EngineStore, raw: RawMessage, m: HashMessage, opts: EngineOptions): Promise<Outcome> {
  const consecNbr = m.consecNbr ?? null;
  const clearTime = raw.receivedAt;

  // FR-21: with consecNbr exactly that alarm; without, exact key + time, else latest ACTIVE.
  let target: Alarm | null;
  if (consecNbr !== null) {
    target = await store.findAlarmByConsec(consecNbr);
  } else {
    target = (await store.findAlarm(m.alarmKey, m.alarmTime)) ?? (await store.findActiveAlarms(m.alarmKey))[0] ?? null;
  }

  if (!target) {
    // FR-22: keep the Clear until its alarm arrives.
    await store.createOrphanClear({
      alarmKey: m.alarmKey,
      subject: raw.subject,
      clearTime,
      rawMessageId: raw.id,
      consecNbr,
      office: raw.office,
    });
    return "orphan";
  }
  if (target.status !== "ACTIVE") return "stale_clear";

  if (target.office !== raw.office) {
    // D-05: matching is global; record when a Clear closes an alarm of another office.
    opts.log?.(
      `cross-office clear: alarm ${target.id} (${target.alarmKey}) office ${target.office ?? "-"} cleared by message ${raw.gmailId} office ${raw.office ?? "-"}`,
    );
  }
  await store.updateAlarm(target.id, {
    status: "CLEARED",
    clearType: "EMAIL",
    clearTime,
    durationMin: durationMinutes(target.alarmTime, clearTime),
  });
  return "cleared";
}

/**
 * FR-24: delete alarms with `alarmTime ≥ since`, reopen alarms with `clearTime ≥ since`, delete
 * orphan clears of the window and re-run every raw message received since then. The caller runs
 * it inside the transaction that holds advisory lock 42.
 */
export async function reprocess(store: EngineStore, since: Date, opts: EngineOptions): Promise<Outcomes> {
  // G-T11 (gap 23): an alarm recreated by the reprocess keeps its createdAt, so alarms a user has
  // already seen do not come back as unread notifications.
  const key = (a: { consecNbr: string | null; alarmKey: string; alarmTime: Date }) =>
    a.consecNbr ?? `${a.alarmKey}|${a.alarmTime.toISOString()}`;
  const createdAt = new Map((await store.findAlarmsFrom(since)).map((a) => [key(a), a.createdAt]));
  await store.resetWindow(since);
  return processBatch(store, { ...opts, createdAtFor: (a) => createdAt.get(key(a)) });
}
