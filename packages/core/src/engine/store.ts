import type { Category } from "../classify";

export type AlarmStatus = "ACTIVE" | "CLEARED";
export type ClearType = "EMAIL" | "AUTO_SUPERSEDED";

export interface RawMessage {
  id: number;
  gmailId: string;
  subject: string;
  receivedAt: Date;
  body: string | null;
  office: string | null;
  parseError: string | null;
  processedAt: Date | null;
}

export type NewRawMessage = Pick<RawMessage, "gmailId" | "subject" | "receivedAt" | "body" | "office">;

export interface Alarm {
  id: number;
  alarmKey: string;
  alarmName: string;
  site: string;
  category: Category;
  alarmTime: Date;
  status: AlarmStatus;
  clearTime: Date | null;
  durationMin: number | null;
  clearType: ClearType | null;
  consecNbr: string | null;
  cellName: string | null;
  device: string | null;
  office: string | null;
  createdAt: Date;
}

export type NewAlarm = Omit<Alarm, "id" | "createdAt">;
export type AlarmUpdate = Partial<Pick<Alarm, "status" | "clearTime" | "durationMin" | "clearType">>;

export interface OrphanClear {
  id: number;
  alarmKey: string;
  subject: string;
  clearTime: Date;
  rawMessageId: number;
  consecNbr: string | null;
  office: string | null;
}

export type NewOrphanClear = Omit<OrphanClear, "id">;

/**
 * What the engine needs from storage. `packages/db/src/repository.ts` provides these operations
 * on PostgreSQL; `MemoryStore` provides them in memory. Lookups are global across offices (D-05).
 */
export interface EngineStore {
  insertRawMessages(rows: NewRawMessage[]): Promise<number>;
  pendingRawMessages(): Promise<RawMessage[]>;
  markProcessed(id: number, parseError?: string | null): Promise<void>;

  findAlarmByConsec(consecNbr: string): Promise<Alarm | null>;
  /** First alarm (lowest id) with this key and time. */
  findAlarm(alarmKey: string, alarmTime: Date): Promise<Alarm | null>;
  /** ACTIVE alarms of the key, newest first. */
  findActiveAlarms(alarmKey: string): Promise<Alarm[]>;
  createAlarm(data: NewAlarm): Promise<Alarm>;
  updateAlarm(id: number, data: AlarmUpdate): Promise<Alarm>;

  /** Oldest first. */
  findOrphanClears(by: { consecNbr: string } | { alarmKey: string }): Promise<OrphanClear[]>;
  createOrphanClear(data: NewOrphanClear): Promise<OrphanClear>;
  deleteOrphanClear(id: number): Promise<void>;

  /** FR-24: see `packages/db` `resetWindow`. */
  resetWindow(since: Date): Promise<void>;
}
