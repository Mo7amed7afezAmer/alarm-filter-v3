import { createServer, type Server } from "node:http";
import type { PrismaClient } from "@alarm/db";

export interface HealthOptions {
  port: number;
  db: PrismaClient;
  /** FR-69: HEALTH_STALE_AFTER_SEC. */
  staleAfterSec: number;
  /** FR-69 start-up grace (= HEALTH_STALE_AFTER_SEC, decided 2026-10-15). */
  graceSec: number;
  startedAt: Date;
  now?: () => Date;
}

/**
 * FR-69: `GET /health` → 503 when the database fails, or when the last run is older than
 * HEALTH_STALE_AFTER_SEC once the start-up grace is over; 200 otherwise. Gmail errors are only
 * reported in the body (NFR-15).
 */
export function startHealthServer(opts: HealthOptions): Server {
  const now = opts.now ?? (() => new Date());
  const server = createServer((req, res) => {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/health") return reply(404, { status: "not_found" });

    void (async () => {
      let status;
      try {
        await opts.db.$queryRaw`SELECT 1`;
        status = await opts.db.systemStatus.findUnique({ where: { id: 1 } });
      } catch {
        return reply(503, { status: "db_error" });
      }
      const t = now().getTime();
      const inGrace = t - opts.startedAt.getTime() < opts.graceSec * 1000;
      const lastRunAt = status?.lastRunAt ?? null;
      const stale = !inGrace && (!lastRunAt || t - lastRunAt.getTime() > opts.staleAfterSec * 1000);
      reply(stale ? 503 : 200, {
        status: stale ? "stale" : "ok",
        lastRunAt,
        lastRunMessages: status?.lastRunMessages ?? 0,
        lastError: status?.lastError ?? null,
        officeLabel: status?.officeLabel ?? null,
      });
    })();
  });
  server.listen(opts.port);
  return server;
}
