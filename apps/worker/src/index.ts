// Worker entry point: one cycle at start-up, then on WORKER_CRON (FR-01); /health (FR-69);
// graceful shutdown waiting at most 25 s for a running cycle (NFR-14).
import cron from "node-cron";
import { PrismaClient } from "@alarm/db";
import { createGmailApi, GmailSetupError } from "./client";
import { ConfigError, loadWorkerConfig } from "./config";
import { startHealthServer } from "./health";
import { LabelDirectory } from "./labels";
import { runOnce, summaryLine } from "./run";
import { createTicker, startSchedule } from "./ticker";

/** NFR-14: how long shutdown waits for a running cycle. */
export const SHUTDOWN_WAIT_MS = 25_000;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function main(): Promise<void> {
  const startedAt = new Date();
  const config = loadWorkerConfig(process.env);
  const gmail = await createGmailApi({ credentialsPath: config.credentialsPath, tokenPath: config.tokenPath });
  const db = new PrismaClient();
  const labels = new LabelDirectory(gmail, config.officeLabelParents, log);

  const health = startHealthServer({
    port: config.healthPort,
    db,
    staleAfterSec: config.healthStaleAfterSec,
    graceSec: config.healthStaleAfterSec,
    startedAt,
  });
  log(`worker started: cron "${config.cron}", health on :${config.healthPort}`);

  const ticker = createTicker(async () => {
    log(summaryLine(await runOnce({ gmail, db, config, labels, log })));
  }, log);

  let task: { stop: () => void } | undefined;
  const shutdown = async (signal: string) => {
    log(`${signal} received, shutting down`);
    task?.stop();
    const idle = await ticker.idle(SHUTDOWN_WAIT_MS);
    if (!idle) log(`a cycle was still running after ${SHUTDOWN_WAIT_MS / 1000} s`);
    health.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await startSchedule(config.cron, ticker.tick, (expression, run) => {
    task = cron.schedule(expression, () => void run());
  });
}

main().catch((err: unknown) => {
  // Start-up problems (missing OAuth files, bad config) stop the worker with a clear message.
  const known = err instanceof GmailSetupError || err instanceof ConfigError;
  console.error(known ? `worker cannot start: ${(err as Error).message}` : err);
  process.exit(1);
});
