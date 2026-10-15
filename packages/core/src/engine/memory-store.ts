import type {
  Alarm,
  AlarmUpdate,
  EngineStore,
  NewAlarm,
  NewOrphanClear,
  NewRawMessage,
  OrphanClear,
  RawMessage,
} from "./store";

/** In-memory `EngineStore` with the same semantics as the PostgreSQL repository. */
export class MemoryStore implements EngineStore {
  rawMessages: RawMessage[] = [];
  alarms: Alarm[] = [];
  orphanClears: OrphanClear[] = [];
  private nextId = 1;

  async insertRawMessages(rows: NewRawMessage[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      if (this.rawMessages.some((r) => r.gmailId === row.gmailId)) continue;
      this.rawMessages.push({ ...row, id: this.nextId++, parseError: null, processedAt: null });
      inserted++;
    }
    return inserted;
  }

  async pendingRawMessages(): Promise<RawMessage[]> {
    return this.rawMessages.filter((r) => r.processedAt === null);
  }

  async markProcessed(id: number, parseError: string | null = null): Promise<void> {
    const raw = this.rawMessages.find((r) => r.id === id);
    if (!raw) throw new Error(`raw message ${id} not found`);
    raw.processedAt = new Date();
    raw.parseError = parseError;
  }

  async findAlarmByConsec(consecNbr: string): Promise<Alarm | null> {
    return this.alarms.find((a) => a.consecNbr === consecNbr) ?? null;
  }

  async findAlarm(alarmKey: string, alarmTime: Date): Promise<Alarm | null> {
    return (
      [...this.alarms]
        .sort((a, b) => a.id - b.id)
        .find((a) => a.alarmKey === alarmKey && a.alarmTime.getTime() === alarmTime.getTime()) ?? null
    );
  }

  async findActiveAlarms(alarmKey: string): Promise<Alarm[]> {
    return this.alarms
      .filter((a) => a.alarmKey === alarmKey && a.status === "ACTIVE")
      .sort((a, b) => b.alarmTime.getTime() - a.alarmTime.getTime() || b.id - a.id);
  }

  async createAlarm(data: NewAlarm): Promise<Alarm> {
    if (data.consecNbr !== null && this.alarms.some((a) => a.consecNbr === data.consecNbr)) {
      throw new Error(`duplicate consecNbr ${data.consecNbr}`);
    }
    const alarm: Alarm = { ...data, id: this.nextId++, createdAt: new Date() };
    this.alarms.push(alarm);
    return alarm;
  }

  async updateAlarm(id: number, data: AlarmUpdate): Promise<Alarm> {
    const alarm = this.alarms.find((a) => a.id === id);
    if (!alarm) throw new Error(`alarm ${id} not found`);
    Object.assign(alarm, data);
    return alarm;
  }

  async findOrphanClears(by: { consecNbr: string } | { alarmKey: string }): Promise<OrphanClear[]> {
    return this.orphanClears
      .filter((o) => ("consecNbr" in by ? o.consecNbr === by.consecNbr : o.alarmKey === by.alarmKey))
      .sort((a, b) => a.clearTime.getTime() - b.clearTime.getTime() || a.id - b.id);
  }

  async createOrphanClear(data: NewOrphanClear): Promise<OrphanClear> {
    const orphan: OrphanClear = { ...data, id: this.nextId++ };
    this.orphanClears.push(orphan);
    return orphan;
  }

  async deleteOrphanClear(id: number): Promise<void> {
    this.orphanClears = this.orphanClears.filter((o) => o.id !== id);
  }

  async resetWindow(since: Date): Promise<void> {
    const t = since.getTime();
    this.alarms = this.alarms.filter((a) => a.alarmTime.getTime() < t);
    for (const a of this.alarms) {
      if (a.clearTime && a.clearTime.getTime() >= t) {
        Object.assign(a, { status: "ACTIVE", clearTime: null, durationMin: null, clearType: null });
      }
    }
    this.orphanClears = this.orphanClears.filter((o) => o.clearTime.getTime() < t);
    for (const r of this.rawMessages) {
      if (r.receivedAt.getTime() >= t) Object.assign(r, { processedAt: null, parseError: null });
    }
  }
}
