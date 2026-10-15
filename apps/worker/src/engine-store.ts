import * as repo from "@alarm/db";
import type { Db } from "@alarm/db";
import type { EngineStore } from "@alarm/core";

/** The engine's storage on PostgreSQL, through the packages/db repository. */
export function prismaEngineStore(db: Db): EngineStore {
  return {
    insertRawMessages: (rows) => repo.insertRawMessages(db, rows),
    pendingRawMessages: () => repo.pendingRawMessages(db),
    markProcessed: (id, parseError) => repo.markProcessed(db, id, parseError ?? null),
    findAlarmByConsec: (consecNbr) => repo.findAlarmByConsec(db, consecNbr),
    findAlarm: (alarmKey, alarmTime) => repo.findAlarm(db, alarmKey, alarmTime),
    findActiveAlarms: (alarmKey) => repo.findActiveAlarms(db, alarmKey),
    createAlarm: (data) => repo.createAlarm(db, data),
    updateAlarm: (id, data) => repo.updateAlarm(db, id, data),
    findOrphanClears: (by) => repo.findOrphanClears(db, by),
    createOrphanClear: (data) => repo.createOrphanClear(db, data),
    deleteOrphanClear: (id) => repo.deleteOrphanClear(db, id),
    resetWindow: async (since) => {
      await repo.resetWindow(db, since);
    },
  };
}
