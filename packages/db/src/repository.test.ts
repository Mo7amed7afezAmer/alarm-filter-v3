import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAlarm,
  createOrphanClear,
  deleteOrphanClear,
  findActiveAlarms,
  findAlarm,
  findAlarmByConsec,
  findOrphanClears,
  insertRawMessages,
  markProcessed,
  pendingRawMessages,
  rawMessagesSince,
  resetWindow,
  updateAlarm,
} from "./repository";
import { freshDatabase, testDatabaseUrl, truncateAll } from "./test-db";

const t = (iso: string) => new Date(iso);

describe.skipIf(!testDatabaseUrl)("repository (alarms_test)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await freshDatabase(testDatabaseUrl!);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function raw(gmailId: string, receivedAt: string, subject = `S ${gmailId}`) {
    await insertRawMessages(db, [{ gmailId, subject, receivedAt: t(receivedAt), body: null, office: "DN/A" }]);
    return db.rawMessage.findUniqueOrThrow({ where: { gmailId } });
  }

  function alarm(over: Partial<Parameters<typeof createAlarm>[1]> = {}) {
    return createAlarm(db, {
      alarmKey: "LINK FAILURE||SITE_A",
      alarmName: "LINK FAILURE",
      site: "SITE_A",
      category: "DOWN",
      alarmTime: t("2026-10-10T10:00:00Z"),
      office: "DN/A",
      ...over,
    });
  }

  describe("raw messages (FR-04, NFR-11, FR-14, FR-18)", () => {
    it("skips duplicate gmailIds and reports how many rows were inserted", async () => {
      const rows = [
        { gmailId: "a", subject: "s", receivedAt: t("2026-10-10T00:00:00Z"), body: null, office: null },
        { gmailId: "b", subject: "s", receivedAt: t("2026-10-10T00:01:00Z"), body: "x", office: "DN/A" },
      ];
      expect(await insertRawMessages(db, rows)).toBe(2);
      expect(await insertRawMessages(db, rows)).toBe(0);
      expect(await db.rawMessage.count()).toBe(2);
    });

    it("lists pending messages and marks them processed, keeping the parse error", async () => {
      const a = await raw("a", "2026-10-10T00:00:00Z");
      const b = await raw("b", "2026-10-10T00:01:00Z");
      expect((await pendingRawMessages(db)).map((m) => m.gmailId).sort()).toEqual(["a", "b"]);

      await markProcessed(db, a.id);
      await markProcessed(db, b.id, "unrecognised subject format");

      expect(await pendingRawMessages(db)).toEqual([]);
      const stored = await db.rawMessage.findUniqueOrThrow({ where: { id: b.id } });
      expect(stored.processedAt).not.toBeNull();
      expect(stored.parseError).toBe("unrecognised subject format");
    });

    it("returns raw messages received since a time", async () => {
      await raw("old", "2026-10-01T00:00:00Z");
      await raw("new", "2026-10-10T00:00:00Z");
      const since = await rawMessagesSince(db, t("2026-10-05T00:00:00Z"));
      expect(since.map((m) => m.gmailId)).toEqual(["new"]);
    });
  });

  describe("alarm lookups (FR-19, FR-20, FR-21)", () => {
    it("findAlarmByConsec finds the alarm with that CONSEC_NBR", async () => {
      const a = await alarm({ consecNbr: "123" });
      expect((await findAlarmByConsec(db, "123"))?.id).toBe(a.id);
      expect(await findAlarmByConsec(db, "999")).toBeNull();
    });

    it("findAlarm matches alarmKey and alarmTime exactly", async () => {
      const a = await alarm();
      expect((await findAlarm(db, a.alarmKey, a.alarmTime))?.id).toBe(a.id);
      expect(await findAlarm(db, a.alarmKey, t("2026-10-10T10:00:01Z"))).toBeNull();
      expect(await findAlarm(db, "OTHER||SITE_A", a.alarmTime)).toBeNull();
    });

    it("findActiveAlarms returns only ACTIVE alarms of the key, newest first", async () => {
      const older = await alarm({ alarmTime: t("2026-10-10T08:00:00Z") });
      const newer = await alarm({ alarmTime: t("2026-10-10T09:00:00Z") });
      const closed = await alarm({ alarmTime: t("2026-10-10T09:30:00Z") });
      await updateAlarm(db, closed.id, {
        status: "CLEARED",
        clearType: "EMAIL",
        clearTime: t("2026-10-10T09:40:00Z"),
        durationMin: 10,
      });
      await alarm({ alarmKey: "OTHER||SITE_A", alarmName: "OTHER" });

      const active = await findActiveAlarms(db, "LINK FAILURE||SITE_A");
      expect(active.map((a) => a.id)).toEqual([newer.id, older.id]);
    });

    it("lookups are not scoped by office (D-05)", async () => {
      const a = await alarm({ office: "DN/A", consecNbr: "77" });
      expect((await findAlarm(db, a.alarmKey, a.alarmTime))?.office).toBe("DN/A");
      expect((await findAlarmByConsec(db, "77"))?.id).toBe(a.id);
      expect((await findActiveAlarms(db, a.alarmKey)).map((x) => x.id)).toEqual([a.id]);
    });

    it("rejects a second alarm with the same CONSEC_NBR", async () => {
      await alarm({ consecNbr: "5" });
      await expect(alarm({ consecNbr: "5" })).rejects.toThrow();
    });
  });

  describe("orphan clears (FR-22)", () => {
    it("stores, finds by consecNbr or key, and deletes orphan clears", async () => {
      const r1 = await raw("c1", "2026-10-10T11:00:00Z");
      const r2 = await raw("c2", "2026-10-10T12:00:00Z");
      const byConsec = await createOrphanClear(db, {
        alarmKey: "LINK FAILURE||SITE_A",
        subject: r1.subject,
        clearTime: r1.receivedAt,
        rawMessageId: r1.id,
        consecNbr: "42",
        office: "DN/A",
      });
      const byKey = await createOrphanClear(db, {
        alarmKey: "LINK FAILURE||SITE_A",
        subject: r2.subject,
        clearTime: r2.receivedAt,
        rawMessageId: r2.id,
        consecNbr: null,
        office: "DN/A",
      });

      expect((await findOrphanClears(db, { consecNbr: "42" })).map((o) => o.id)).toEqual([byConsec.id]);
      expect((await findOrphanClears(db, { alarmKey: "LINK FAILURE||SITE_A" })).map((o) => o.id)).toEqual([
        byConsec.id,
        byKey.id,
      ]);

      await deleteOrphanClear(db, byConsec.id);
      expect((await findOrphanClears(db, { consecNbr: "42" }))).toEqual([]);
    });
  });

  describe("resetWindow (FR-24, NFR-13)", () => {
    async function scenario() {
      const since = t("2026-10-10T00:00:00Z");
      // before the window, still active → untouched
      const keep = await alarm({ alarmKey: "K1", alarmTime: t("2026-10-09T10:00:00Z") });
      // before the window, cleared inside it → reopened
      const reopen = await alarm({ alarmKey: "K2", alarmTime: t("2026-10-09T11:00:00Z") });
      await updateAlarm(db, reopen.id, {
        status: "CLEARED",
        clearType: "EMAIL",
        clearTime: t("2026-10-10T01:00:00Z"),
        durationMin: 840,
      });
      // before the window, cleared before it → untouched
      const closedBefore = await alarm({ alarmKey: "K3", alarmTime: t("2026-10-09T01:00:00Z") });
      await updateAlarm(db, closedBefore.id, {
        status: "CLEARED",
        clearType: "AUTO_SUPERSEDED",
        clearTime: t("2026-10-09T02:00:00Z"),
        durationMin: 60,
      });
      // inside the window → deleted
      await alarm({ alarmKey: "K4", alarmTime: t("2026-10-10T05:00:00Z") });

      const oldRaw = await raw("old", "2026-10-09T12:00:00Z");
      const newRaw = await raw("new", "2026-10-10T06:00:00Z");
      await markProcessed(db, oldRaw.id);
      await markProcessed(db, newRaw.id, "unrecognised subject format");
      const oldOrphanRaw = await raw("o-old", "2026-10-09T13:00:00Z");
      const newOrphanRaw = await raw("o-new", "2026-10-10T07:00:00Z");
      await markProcessed(db, oldOrphanRaw.id);
      await markProcessed(db, newOrphanRaw.id);
      await createOrphanClear(db, {
        alarmKey: "K5", subject: "x", clearTime: oldOrphanRaw.receivedAt, rawMessageId: oldOrphanRaw.id, consecNbr: null, office: null,
      });
      await createOrphanClear(db, {
        alarmKey: "K6", subject: "y", clearTime: newOrphanRaw.receivedAt, rawMessageId: newOrphanRaw.id, consecNbr: null, office: null,
      });
      return { since, keep, reopen, closedBefore };
    }

    async function snapshot() {
      const byKey = (a: { alarmKey: string }, b: { alarmKey: string }) => (a.alarmKey < b.alarmKey ? -1 : 1);
      const alarms = (await db.alarm.findMany()).sort(byKey);
      const orphans = (await db.orphanClear.findMany()).sort(byKey);
      const raws = (await db.rawMessage.findMany()).sort((a, b) => (a.gmailId < b.gmailId ? -1 : 1));
      return {
        alarms: alarms.map((a) => [a.alarmKey, a.status, a.clearTime?.toISOString() ?? null, a.durationMin, a.clearType]),
        orphans: orphans.map((o) => o.alarmKey),
        raws: raws.map((r) => [r.gmailId, r.processedAt === null, r.parseError]),
      };
    }

    it("deletes alarms in the window, reopens alarms cleared in it, deletes its orphan clears and re-queues its raw messages", async () => {
      const { since } = await scenario();
      await resetWindow(db, since);

      expect(await snapshot()).toEqual({
        alarms: [
          ["K1", "ACTIVE", null, null, null],
          ["K2", "ACTIVE", null, null, null],
          ["K3", "CLEARED", "2026-10-09T02:00:00.000Z", 60, "AUTO_SUPERSEDED"],
        ],
        orphans: ["K5"],
        raws: [
          ["new", true, null],
          ["o-new", true, null],
          ["o-old", false, null],
          ["old", false, null],
        ],
      });
    });

    it("is idempotent: two runs leave the same state", async () => {
      const { since } = await scenario();
      await resetWindow(db, since);
      const first = await snapshot();
      await resetWindow(db, since);
      expect(await snapshot()).toEqual(first);
    });
  });
});
