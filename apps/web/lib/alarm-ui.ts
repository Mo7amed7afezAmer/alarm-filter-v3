// Shared by the alarm pages (FR-33, FR-34, NFR-06). Browser-safe.

/** FR-33 / NFR-06: the age column re-renders every 30 s; the lists refresh every 60 s. */
export const AGE_TICK_MS = 30_000;
export const ALARMS_REFRESH_MS = 60_000;

/** FR-33: ALERT_HOURS, default 4. */
export function alertHoursFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 4;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 4;
}

export function isAlert(alarmTime: Date, now: Date, alertHours: number): boolean {
  return now.getTime() - alarmTime.getTime() > alertHours * 3600_000;
}

export function ageText(alarmTime: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - alarmTime.getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** FR-34: a tel: link for the first number of a phone field ("a / b"). */
export function telHref(phone: string): string {
  const first = phone.split("/")[0] ?? "";
  return `tel:${first.replace(/[^\d+]/g, "")}`;
}
