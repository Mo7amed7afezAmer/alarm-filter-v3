import { db } from "@/lib/db";

// Reads the database on every request.
export const dynamic = "force-dynamic";

/** FR-70: worker freshness threshold, WORKER_STALE_SEC (default 300 s). */
function staleAfterSec(): number {
  const n = Number(process.env.WORKER_STALE_SEC);
  return process.env.WORKER_STALE_SEC && Number.isFinite(n) && n > 0 ? n : 300;
}

// FR-70: public — 503 when SELECT 1 fails, else 200 with worker freshness in the body.
// Kept at /api/health as the one exception to D-02 (decided 2026-10-16).
export async function GET(): Promise<Response> {
  let status;
  try {
    await db.$queryRaw`SELECT 1`;
    status = await db.systemStatus.findUnique({ where: { id: 1 } });
  } catch {
    return Response.json({ status: "db_error" }, { status: 503 });
  }
  const lastRunAt = status?.lastRunAt ?? null;
  const stale = !lastRunAt || Date.now() - lastRunAt.getTime() > staleAfterSec() * 1000;
  return Response.json({
    status: "ok",
    worker: { lastRunAt, lastRunMessages: status?.lastRunMessages ?? 0, lastError: status?.lastError ?? null, stale },
  });
}
