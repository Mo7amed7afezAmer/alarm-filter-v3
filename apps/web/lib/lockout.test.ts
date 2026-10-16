import { describe, expect, it } from "vitest";
import { LOCKOUT_MAX_FAILURES, LOCKOUT_WINDOW_MS, LoginLockout } from "./lockout";

// D-08: in-app per-email lockout after 5 failures for 15 minutes (in memory, D-04).
const t0 = new Date("2026-10-16T08:00:00Z").getTime();

describe("LoginLockout", () => {
  it("uses 5 failures and 15 minutes", () => {
    expect(LOCKOUT_MAX_FAILURES).toBe(5);
    expect(LOCKOUT_WINDOW_MS).toBe(15 * 60_000);
  });

  it("locks an e-mail after 5 failures and unlocks 15 minutes after the last one", () => {
    const l = new LoginLockout();
    for (let i = 0; i < 4; i++) l.fail("ops@noc.test", t0 + i * 1000);
    expect(l.isLocked("ops@noc.test", t0 + 4000)).toBe(false);
    l.fail("ops@noc.test", t0 + 4000);
    expect(l.isLocked("ops@noc.test", t0 + 5000)).toBe(true);
    expect(l.isLocked("ops@noc.test", t0 + 4000 + LOCKOUT_WINDOW_MS - 1)).toBe(true);
    expect(l.isLocked("ops@noc.test", t0 + 4000 + LOCKOUT_WINDOW_MS)).toBe(false);
  });

  it("counts only failures inside the 15-minute window", () => {
    const l = new LoginLockout();
    for (let i = 0; i < 4; i++) l.fail("ops@noc.test", t0);
    l.fail("ops@noc.test", t0 + LOCKOUT_WINDOW_MS + 1);
    expect(l.isLocked("ops@noc.test", t0 + LOCKOUT_WINDOW_MS + 2)).toBe(false);
  });

  it("is per e-mail, case-insensitive", () => {
    const l = new LoginLockout();
    for (let i = 0; i < 5; i++) l.fail("Ops@NOC.test", t0);
    expect(l.isLocked("ops@noc.test", t0 + 1)).toBe(true);
    expect(l.isLocked("other@noc.test", t0 + 1)).toBe(false);
  });

  it("clears the failures after a successful login", () => {
    const l = new LoginLockout();
    for (let i = 0; i < 4; i++) l.fail("ops@noc.test", t0);
    l.succeed("ops@noc.test");
    l.fail("ops@noc.test", t0 + 1);
    expect(l.isLocked("ops@noc.test", t0 + 2)).toBe(false);
  });
});
