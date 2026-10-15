// Alarm time handling (FR-10, NFR-29). Browser-safe: uses Intl only, no Node APIs.

/** Default `ALARM_TZ`. Callers pass the configured value. */
export const DEFAULT_ALARM_TZ = "Africa/Cairo";

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const STAMP_RE = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at instant `utcMs`, in milliseconds. */
function offsetMs(utcMs: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant (DST-aware). */
export function zonedToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  tz: string = DEFAULT_ALARM_TZ,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes settle the offset on both sides of a DST change.
  let utc = wall - offsetMs(wall, tz);
  utc = wall - offsetMs(utc, tz);
  return new Date(utc);
}

/** Parses `DD-MON-YYYY HH:mm:ss` (wall clock in `tz`); null for a malformed or impossible date. */
export function parseAlarmStamp(text: string, tz: string = DEFAULT_ALARM_TZ): Date | null {
  const m = STAMP_RE.exec(text.trim());
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mi, ss] = m;
  const month = MONTHS[mon!.toUpperCase()];
  if (!month) return null;
  const year = Number(yyyy), day = Number(dd), hour = Number(hh), minute = Number(mi), second = Number(ss);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedToUtc(year, month, day, hour, minute, second, tz);
}
