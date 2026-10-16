import type { PrismaClient } from "@alarm/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { db as appDb } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { freshDatabase, testDatabaseUrl } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));

// FR-70: public GET /api/health — 503 when SELECT 1 fails, else 200 with worker freshness
// (WORKER_STALE_SEC, default 300 s) in the body.
describe.skipIf(!testDatabaseUrl)("GET /api/health", () => {
  let db: PrismaClient;
  const now = new Date("2026-10-11T19:00:00Z");

  beforeAll(async () => {
    db = await freshDatabase();
    vi.useFakeTimers({ now, toFake: ["Date"] });
  });
  beforeEach(async () => {
    await db.systemStatus.deleteMany();
    vi.mocked(getSessionUser).mockResolvedValue(null);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await db?.$disconnect();
  });

  const health = async () => {
    const res = await GET();
    return { status: res.status, body: (await res.json()) as { status: string; worker: Record<string, unknown> } };
  };

  it("needs no session and answers 200 with a fresh worker", async () => {
    await db.systemStatus.create({ data: { id: 1, lastRunAt: new Date(now.getTime() - 60_000), lastRunMessages: 4 } });
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      worker: { lastRunAt: "2026-10-11T18:59:00.000Z", lastRunMessages: 4, lastError: null, stale: false },
    });
  });

  it("reports a stale worker (last run older than WORKER_STALE_SEC) but stays 200", async () => {
    await db.systemStatus.create({ data: { id: 1, lastRunAt: new Date(now.getTime() - 301_000) } });
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.worker.stale).toBe(true);
  });

  it("reports a worker that never ran as stale", async () => {
    expect((await health()).body.worker).toMatchObject({ lastRunAt: null, stale: true });
  });

  it("uses WORKER_STALE_SEC", async () => {
    vi.stubEnv("WORKER_STALE_SEC", "600");
    await db.systemStatus.create({ data: { id: 1, lastRunAt: new Date(now.getTime() - 301_000) } });
    expect((await health()).body.worker.stale).toBe(false);
    vi.unstubAllEnvs();
  });

  it("passes the worker's lastError through", async () => {
    await db.systemStatus.create({ data: { id: 1, lastRunAt: now, lastError: "Gmail API 500" } });
    expect((await health()).body.worker.lastError).toBe("Gmail API 500");
  });

  it("answers 503 when SELECT 1 fails", async () => {
    const spy = vi.spyOn(appDb, "$queryRaw").mockRejectedValueOnce(new Error("db down"));
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.status).toBe("db_error");
    spy.mockRestore();
  });
});
