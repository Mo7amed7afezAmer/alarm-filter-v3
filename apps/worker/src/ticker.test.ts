import { describe, expect, it, vi } from "vitest";
import { createTicker, startSchedule } from "./ticker";

describe("ticker (FR-01, NFR-10)", () => {
  it("runs one cycle at start-up and then on the WORKER_CRON schedule", async () => {
    const cycle = vi.fn(async () => {});
    const ticker = createTicker(cycle, () => {});
    const schedule = vi.fn();

    await startSchedule("* * * * *", ticker.tick, schedule);

    expect(cycle).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith("* * * * *", ticker.tick);
  });

  it("skips (and logs) a tick while the previous cycle is still running", async () => {
    let release!: () => void;
    const cycle = vi.fn(() => new Promise<void>((r) => (release = r)));
    const log = vi.fn();
    const ticker = createTicker(cycle, log);

    const first = ticker.tick();
    expect(ticker.isRunning()).toBe(true);
    await ticker.tick();

    expect(cycle).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"));

    release();
    await first;
    expect(ticker.isRunning()).toBe(false);
    const third = ticker.tick();
    expect(cycle).toHaveBeenCalledTimes(2);
    release();
    await third;
  });

  it("does not crash when a cycle fails (NFR-15)", async () => {
    const log = vi.fn();
    const ticker = createTicker(async () => {
      throw new Error("Gmail down");
    }, log);
    await expect(ticker.tick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Gmail down"));
    expect(ticker.isRunning()).toBe(false);
  });

  it("idle() waits for a running cycle, up to a timeout (NFR-14)", async () => {
    let release!: () => void;
    const ticker = createTicker(
      () => new Promise<void>((r) => (release = r)),
      () => {},
    );
    void ticker.tick();

    expect(await ticker.idle(20)).toBe(false);
    release();
    expect(await ticker.idle(1000)).toBe(true);
  });
});
