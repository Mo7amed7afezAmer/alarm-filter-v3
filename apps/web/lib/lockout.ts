// D-08: in-app login protection — 5 failed logins for one e-mail within 15 minutes lock that
// e-mail for 15 minutes after the 5th failure. In memory: single web replica (D-04, R-07).

export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  private entry(email: string): Entry {
    const key = email.toLowerCase();
    let e = this.entries.get(key);
    if (!e) {
      e = { failures: [], lockedUntil: 0 };
      this.entries.set(key, e);
    }
    return e;
  }

  isLocked(email: string, now: number): boolean {
    return (this.entries.get(email.toLowerCase())?.lockedUntil ?? 0) > now;
  }

  fail(email: string, now: number): void {
    const e = this.entry(email);
    e.failures = [...e.failures.filter((t) => now - t < LOCKOUT_WINDOW_MS), now];
    if (e.failures.length >= LOCKOUT_MAX_FAILURES) {
      e.lockedUntil = now + LOCKOUT_WINDOW_MS;
      e.failures = [];
    }
  }

  succeed(email: string): void {
    this.entries.delete(email.toLowerCase());
  }
}

/** The lockout of this web process. */
export const loginLockout = new LoginLockout();
