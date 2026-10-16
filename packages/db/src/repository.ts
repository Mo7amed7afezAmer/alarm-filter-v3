import type { Alarm, OrphanClear, Prisma, PrismaClient, RawMessage } from "@prisma/client";

/** A client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------- raw messages

export interface NewRawMessage {
  gmailId: string;
  subject: string;
  receivedAt: Date;
  body: string | null;
  office: string | null;
}

/** FR-04 / NFR-11: insert, skipping gmailIds already stored. Returns the number inserted. */
export async function insertRawMessages(db: Db, rows: NewRawMessage[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await db.rawMessage.createMany({ data: rows, skipDuplicates: true });
  return count;
}

/** FR-04: lookups of stored gmailIds are made in chunks of this size. */
export const IN_CHUNK = 1000;

/** FR-04: which of these gmailIds are already in raw_messages. */
export async function knownGmailIds(db: Db, gmailIds: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < gmailIds.length; i += IN_CHUNK) {
    const rows = await db.rawMessage.findMany({
      where: { gmailId: { in: gmailIds.slice(i, i + IN_CHUNK) } },
      select: { gmailId: true },
    });
    for (const r of rows) known.add(r.gmailId);
  }
  return known;
}

/** FR-18: messages not processed yet (`processedAt` null). */
export function pendingRawMessages(db: Db): Promise<RawMessage[]> {
  return db.rawMessage.findMany({ where: { processedAt: null } });
}

/** FR-14: mark a message processed, keeping the parse error when there is one. */
export async function markProcessed(db: Db, id: number, parseError: string | null = null): Promise<void> {
  await db.rawMessage.update({ where: { id }, data: { processedAt: new Date(), parseError } });
}

/** FR-24: raw messages received at or after `since`. */
export function rawMessagesSince(db: Db, since: Date): Promise<RawMessage[]> {
  return db.rawMessage.findMany({ where: { receivedAt: { gte: since } }, orderBy: { receivedAt: "asc" } });
}

// ---------------------------------------------------------------- alarms
// Lookups are global across offices (D-05).

/** FR-19 / FR-21: the alarm with this CONSEC_NBR. */
export function findAlarmByConsec(db: Db, consecNbr: string): Promise<Alarm | null> {
  return db.alarm.findUnique({ where: { consecNbr } });
}

/** FR-19 / FR-21: the alarm with exactly this key and time. */
export function findAlarm(db: Db, alarmKey: string, alarmTime: Date): Promise<Alarm | null> {
  return db.alarm.findFirst({ where: { alarmKey, alarmTime }, orderBy: { id: "asc" } });
}

/** FR-20 / FR-21: ACTIVE alarms of a key, newest first. */
export function findActiveAlarms(db: Db, alarmKey: string): Promise<Alarm[]> {
  return db.alarm.findMany({
    where: { alarmKey, status: "ACTIVE" },
    orderBy: [{ alarmTime: "desc" }, { id: "desc" }],
  });
}

export type NewAlarm = Pick<Alarm, "alarmKey" | "alarmName" | "site" | "category" | "alarmTime"> &
  Partial<Pick<Alarm, "status" | "clearTime" | "durationMin" | "clearType" | "consecNbr" | "cellName" | "device" | "office" | "createdAt">>;

/** FR-24: alarms with alarmTime ≥ since (the ones resetWindow deletes). */
export function findAlarmsFrom(db: Db, since: Date): Promise<Alarm[]> {
  return db.alarm.findMany({ where: { alarmTime: { gte: since } } });
}

export function createAlarm(db: Db, data: NewAlarm): Promise<Alarm> {
  return db.alarm.create({ data });
}

export type AlarmUpdate = Partial<Pick<Alarm, "status" | "clearTime" | "durationMin" | "clearType" | "category">>;

export function updateAlarm(db: Db, id: number, data: AlarmUpdate): Promise<Alarm> {
  return db.alarm.update({ where: { id }, data });
}

// ---------------------------------------------------------------- orphan clears

export type NewOrphanClear = Pick<
  OrphanClear,
  "alarmKey" | "subject" | "clearTime" | "rawMessageId" | "consecNbr" | "office"
>;

/** FR-22: store a Clear that has no target yet. */
export function createOrphanClear(db: Db, data: NewOrphanClear): Promise<OrphanClear> {
  return db.orphanClear.create({ data });
}

/** FR-22: orphan clears with this CONSEC_NBR, or with this key; oldest first. */
export function findOrphanClears(
  db: Db,
  by: { consecNbr: string } | { alarmKey: string },
): Promise<OrphanClear[]> {
  return db.orphanClear.findMany({ where: by, orderBy: [{ clearTime: "asc" }, { id: "asc" }] });
}

/** FR-22: an orphan clear is consumed when its alarm arrives. */
export async function deleteOrphanClear(db: Db, id: number): Promise<void> {
  await db.orphanClear.delete({ where: { id } });
}

// ---------------------------------------------------------------- reprocess

export interface ResetWindowResult {
  alarmsDeleted: number;
  alarmsReopened: number;
  orphansDeleted: number;
  messagesRequeued: number;
}

/**
 * FR-24: prepare a reprocess window. Deletes alarms with `alarmTime ≥ since`, reopens alarms with
 * `clearTime ≥ since`, deletes orphan clears from the window and re-queues raw messages received
 * since then. Idempotent (NFR-13).
 */
export async function resetWindow(db: Db, since: Date): Promise<ResetWindowResult> {
  const deleted = await db.alarm.deleteMany({ where: { alarmTime: { gte: since } } });
  const reopened = await db.alarm.updateMany({
    where: { clearTime: { gte: since } },
    data: { status: "ACTIVE", clearTime: null, durationMin: null, clearType: null },
  });
  const orphans = await db.orphanClear.deleteMany({ where: { clearTime: { gte: since } } });
  const requeued = await db.rawMessage.updateMany({
    where: { receivedAt: { gte: since } },
    data: { processedAt: null, parseError: null },
  });
  return {
    alarmsDeleted: deleted.count,
    alarmsReopened: reopened.count,
    orphansDeleted: orphans.count,
    messagesRequeued: requeued.count,
  };
}
