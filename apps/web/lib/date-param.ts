import { DEFAULT_ALARM_TZ, zonedToUtc } from "@alarm/core";

/** NFR-29: ALARM_TZ, default Africa/Cairo. */
export function alarmTz(): string {
  return process.env.ALARM_TZ?.trim() || DEFAULT_ALARM_TZ;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A date query parameter: `YYYY-MM-DD` is local midnight in `tz` (e.g. 2026-10-14 →
 * 2026-10-13T21:00:00Z in Cairo summer time); a full ISO timestamp with offset is used as is.
 * Null when the value is neither.
 */
export function parseDateParam(value: string, tz: string = alarmTz()): Date | null {
  const d = DATE_ONLY.exec(value);
  if (d) {
    const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const check = new Date(Date.UTC(y, m - 1, day));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return null;
    return zonedToUtc(y, m, day, 0, 0, 0, tz);
  }
  if (!ISO.test(value)) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t;
}

/** `YYYY-MM-DD HH:mm:ss` wall clock in `tz` (exports, NFR-29). */
export function formatLocal(date: Date, tz: string = alarmTz()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The local calendar day (`YYYY-MM-DD`) of an instant in `tz`. */
export function localDay(date: Date, tz: string = alarmTz()): string {
  return formatLocal(date, tz).slice(0, 10);
}
