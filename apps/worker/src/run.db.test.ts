import { execSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { PrismaClient, SEED_RULES } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { startHealthServer } from "./health";
import { LabelDirectory } from "./labels";
import { runOnce, type RunDeps } from "./run";
import { GONE_ID, MockGmail, OFFICE, SAMPLE_IDS, type MockOptions } from "./test/mock-gmail";

const url = process.env.TEST_DATABASE_URL;
const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));
const FETCHABLE = SAMPLE_IDS.filter((id) => id !== GONE_ID);
const T0 = new Date("2026-10-11T19:00:00Z");

describe.skipIf(!url)("worker cycle against alarms_test", () => {
  let db: PrismaClient;
  let config: WorkerConfig;

  beforeAll(async () => {
    if (new URL(url!).pathname !== "/alarms_test") throw new Error("TEST_DATABASE_URL must point at alarms_test");
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await db.$executeRawUnsafe("CREATE SCHEMA public");
    execSync("pnpm exec prisma migrate deploy", { cwd: dbPackage, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  });

  beforeEach(async () => {
    await db.$transaction([
      db.orphanClear.deleteMany(),
      db.rawMessage.deleteMany(),
      db.alarm.deleteMany(),
      db.rule.deleteMany(),
      db.systemStatus.deleteMany(),
    ]);
    await db.rule.createMany({ data: SEED_RULES });
    config = loadWorkerConfig({
      GOOGLE_CREDENTIALS_PATH: "unused",
      GOOGLE_TOKEN_PATH: "unused",
      GMAIL_LABELS: `${OFFICE.name},DS/Zagazig`,
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function deps(gmail = new MockGmail(), now = T0, log = vi.fn()): RunDeps & { gmail: MockGmail; log: typeof log } {
    return { gmail, db, config, labels: new LabelDirectory(gmail, config.officeLabelParents, log), now: () => now, log };
  }
  const status = () => db.systemStatus.findUniqueOrThrow({ where: { id: 1 } });

  describe("FR-07 office label", () => {
    it("reads the first GMAIL_LABELS entry when no office is selected", async () => {
      const d = deps();
      const result = await runOnce(d);

      expect(result).toMatchObject({ outcome: "ran", office: OFFICE.name, mode: "backfill", inserted: FETCHABLE.length });
      const q = (d.gmail.calls.find((c) => c.method === "messagesList")!.params as { q: string }).q;
      expect(q).toContain(`label:"${OFFICE.name}"`);
      const rows = await db.rawMessage.findMany();
      expect(rows.every((r) => r.office === OFFICE.name)).toBe(true);
    });

    it("reads system_status.officeLabel when one is selected", async () => {
      await db.systemStatus.create({ data: { id: 1, officeLabel: "DS/Zagazig" } });
      const result = await runOnce(deps());
      expect(result).toMatchObject({ outcome: "ran", office: "DS/Zagazig" });
      expect((await status()).syncedLabel).toBe("DS/Zagazig");
    });

    it("uses history.list on the label id once the office is synced, and backfills when it changes (FR-03)", async () => {
      await runOnce(deps());
      expect(await status()).toMatchObject({ lastHistoryId: "8100", syncedLabel: OFFICE.name });

      const again = deps();
      expect(await runOnce(again)).toMatchObject({ mode: "history", inserted: 0 });
      expect(again.gmail.calls.find((c) => c.method === "historyList")!.params).toMatchObject({
        startHistoryId: "8100",
        labelId: OFFICE.id,
      });

      await db.systemStatus.update({ where: { id: 1 }, data: { officeLabel: "DS/Zagazig" } });
      expect(await runOnce(deps())).toMatchObject({ mode: "backfill", office: "DS/Zagazig" });
    });

    it("fails the cycle when no office is selected and GMAIL_LABELS is empty", async () => {
      config = { ...config, gmailLabels: [] };
      await expect(runOnce(deps())).rejects.toThrow("GMAIL_LABELS");
    });
  });

  describe("FR-08 available office labels", () => {
    it("stores the labels under OFFICE_LABEL_PARENTS, refreshed at most every 10 minutes", async () => {
      const gmail = new MockGmail();
      const d = deps(gmail);
      await runOnce(d);
      expect((await status()).availableLabels).toEqual(["DN/Kafr ElDawar", "DN/Tanta", "DS/Zagazig"]);

      await runOnce({ ...d, now: () => new Date(T0.getTime() + 60_000) });
      expect(gmail.count("labelsList")).toBe(1);
    });

    it("logs a refresh failure only; the cycle still runs with cached labels", async () => {
      const d = deps();
      await runOnce(d);
      const failing = new MockGmail({ failLabels: 500 });
      Object.assign(d.labels, { gmail: failing });
      const later = new Date(T0.getTime() + 11 * 60_000);

      const result = await runOnce({ ...d, gmail: failing, now: () => later });
      expect(result.outcome).toBe("ran");
      expect(d.log).toHaveBeenCalledWith(expect.stringContaining("label refresh failed"));
      expect((await status()).lastError).toBeNull();
    });
  });

  describe("FR-09 system_status", () => {
    it("records lastRunAt and lastRunMessages and clears lastError on success", async () => {
      await db.systemStatus.create({ data: { id: 1, lastError: "old failure" } });
      await runOnce(deps());
      expect(await status()).toMatchObject({ lastRunAt: T0, lastRunMessages: FETCHABLE.length, lastError: null });
    });

    it("records lastError (≤ 2000 chars) and lastRunAt on failure without throwing away state", async () => {
      const long = "x".repeat(3000);
      const gmail = new MockGmail();
      vi.spyOn(gmail, "getProfile").mockRejectedValue(new Error(long));

      await expect(runOnce(deps(gmail))).rejects.toThrow();
      const s = await status();
      expect(s.lastError).toHaveLength(2000);
      expect(s.lastRunAt).toEqual(T0);
      expect(await db.rawMessage.count()).toBe(0);
    });

    it("holds lastHistoryId while Gmail is throttling (FR-05, NFR-12)", async () => {
      const opts: MockOptions = { failGetFrom: { call: 3, status: 429 } };
      await runOnce(deps(new MockGmail(opts)));
      expect((await status()).lastHistoryId).toBeNull();
    });
  });

  describe("engine run", () => {
    it("processes the stored messages into alarms", async () => {
      const result = await runOnce(deps());
      expect(result.outcome === "ran" && result.processed.created).toBeGreaterThan(0);
      expect(await db.rawMessage.count({ where: { processedAt: null } })).toBe(0);
      expect(await db.alarm.count()).toBeGreaterThan(0);
    });
  });

  describe("FR-24 reprocess flag", () => {
    it("reprocesses the window, resets reprocessDays and yields the same alarms", async () => {
      await runOnce(deps());
      const before = await db.alarm.findMany({ orderBy: [{ alarmTime: "asc" }, { alarmKey: "asc" }] });
      await db.systemStatus.update({ where: { id: 1 }, data: { reprocessDays: 7 } });

      const result = await runOnce(deps());
      expect(result).toMatchObject({ outcome: "ran", reprocessed: true });
      expect((await status()).reprocessDays).toBeNull();
      const after = await db.alarm.findMany({ orderBy: [{ alarmTime: "asc" }, { alarmKey: "asc" }] });
      // Ids and createdAt change when alarms are recreated; everything else must match.
      const shape = (rows: typeof before) =>
        rows.map((a) => ({ ...a, id: undefined, createdAt: undefined }));
      expect(shape(after)).toEqual(shape(before));
    });
  });

  describe("NFR-10 advisory lock 42 (D-03: second instance skips)", () => {
    it("two concurrent instances → exactly one runs the cycle", async () => {
      const a = deps(new MockGmail({ getDelayMs: 200 }));
      const b = deps(new MockGmail({ getDelayMs: 200 }));
      const results = await Promise.all([runOnce(a), runOnce(b)]);

      expect(results.map((r) => r.outcome).sort()).toEqual(["locked", "ran"]);
      expect(await db.rawMessage.count()).toBe(FETCHABLE.length);
      const skipped = results[0]!.outcome === "locked" ? a : b;
      expect(skipped.log).toHaveBeenCalledWith(expect.stringContaining("lock 42"));
    });
  });

  describe("FR-69 /health", () => {
    async function get(server: ReturnType<typeof startHealthServer>) {
      await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }
    const health = (now: Date, startedAt = T0) =>
      startHealthServer({ port: 0, db, staleAfterSec: 300, graceSec: 300, startedAt, now: () => now });

    it("answers 200 with lastError after a forced failure (NFR-15)", async () => {
      const gmail = new MockGmail();
      vi.spyOn(gmail, "getProfile").mockRejectedValue(new Error("Gmail API 500"));
      await expect(runOnce(deps(gmail))).rejects.toThrow();

      const server = health(new Date(T0.getTime() + 10_000));
      try {
        const { status: code, body } = await get(server);
        expect(code).toBe(200);
        expect(body.lastError).toBe("Gmail API 500");
      } finally {
        server.close();
      }
    });

    it("answers 503 when the last run is older than HEALTH_STALE_AFTER_SEC after the start-up grace", async () => {
      await runOnce(deps());
      const server = health(new Date(T0.getTime() + 301_000), new Date(T0.getTime() - 600_000));
      try {
        expect((await get(server)).status).toBe(503);
      } finally {
        server.close();
      }
    });

    it("answers 200 for a stale run during the start-up grace", async () => {
      const server = health(new Date(T0.getTime() + 100_000), T0);
      try {
        expect((await get(server)).status).toBe(200);
      } finally {
        server.close();
      }
    });

    it("answers 503 when the database fails", async () => {
      const broken = new PrismaClient({ datasources: { db: { url: "postgresql://nobody:x@127.0.0.1:1/none" } } });
      const server = startHealthServer({ port: 0, db: broken, staleAfterSec: 300, graceSec: 300, startedAt: T0, now: () => T0 });
      try {
        expect((await get(server)).status).toBe(503);
      } finally {
        server.close();
        await broken.$disconnect();
      }
    });
  });
});
