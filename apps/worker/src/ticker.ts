// FR-01: one cycle at start-up, then on WORKER_CRON; a tick is skipped while a cycle runs (NFR-10).

export type Log = (line: string) => void;

export interface Ticker {
  tick: () => Promise<void>;
  isRunning: () => boolean;
  /** NFR-14: resolves true once no cycle is running, false after `timeoutMs`. */
  idle: (timeoutMs: number) => Promise<boolean>;
}

export function createTicker(cycle: () => Promise<void>, log: Log): Ticker {
  let running: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (running) {
      log("cycle skipped: previous cycle still running");
      return;
    }
    running = (async () => {
      try {
        await cycle();
      } catch (err) {
        // NFR-15: the error is recorded in system_status by the cycle; the worker keeps running.
        log(`cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }

  async function idle(timeoutMs: number): Promise<boolean> {
    const current = running;
    if (!current) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((r) => (timer = setTimeout(() => r(false), timeoutMs)));
    const done = current.then(() => true as const);
    const result = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return result;
  }

  return { tick, isRunning: () => running !== null, idle };
}

export type Schedule = (expression: string, task: () => void | Promise<void>) => unknown;

export async function startSchedule(expression: string, tick: () => Promise<void>, schedule: Schedule): Promise<void> {
  await tick();
  schedule(expression, tick);
}
