// FR-61: compare two reports; rows are keyed by code|alarmName|dn and the time is ignored.
import type { HourlyRow } from "./types";

export function hourlyDiffKey(row: Pick<HourlyRow, "siteCode" | "alarmName" | "dn">): string {
  return `${row.siteCode}|${row.alarmName}|${row.dn}`;
}

/** `new`: rows of `current` whose key is not in `previous`; `disappeared`: the reverse. */
export function diffHourly<R extends Pick<HourlyRow, "siteCode" | "alarmName" | "dn">>(previous: R[], current: R[]) {
  const prev = new Set(previous.map(hourlyDiffKey));
  const cur = new Set(current.map(hourlyDiffKey));
  const unique = (rows: R[], keep: (k: string) => boolean) => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = hourlyDiffKey(r);
      if (seen.has(k) || !keep(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { new: unique(current, (k) => !prev.has(k)), disappeared: unique(previous, (k) => !cur.has(k)) };
}
