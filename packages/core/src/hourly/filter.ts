// FR-59: report row filters, sort, paging and facets — computed in the browser (D-10).
import type { Category } from "../classify";
import type { HourlyRow } from "./types";

/** Multi-select filters are OR within a filter and AND across filters. */
export interface HourlyFilter {
  sheet?: string[];
  region?: string[];
  office?: string[];
  alarm?: string[];
  siteType?: string[];
  category?: Category[];
  vip?: boolean;
  /** Wall-clock bounds `YYYY-MM-DD HH:mm:ss`, inclusive. */
  from?: string;
  to?: string;
  /** Case-insensitive text search. */
  q?: string;
}

const SEARCH_FIELDS = ["alarmName", "alarmText", "supplementaryInfo", "siteName", "siteCode", "dn", "office"] as const;

const inList = (list: string[] | undefined, value: string | null) => !list?.length || (value !== null && list.includes(value));

export function filterHourlyRows<R extends HourlyRow>(rows: R[], f: HourlyFilter): R[] {
  const q = f.q?.trim().toUpperCase();
  return rows.filter(
    (r) =>
      inList(f.sheet, r.sheet) &&
      inList(f.region, r.region) &&
      inList(f.office, r.office) &&
      inList(f.alarm, r.alarmName) &&
      inList(f.siteType, r.siteType) &&
      inList(f.category, r.category) &&
      (f.vip === undefined || r.vip === f.vip) &&
      (!f.from || r.alarmTime >= f.from) &&
      (!f.to || r.alarmTime <= f.to) &&
      (!q || SEARCH_FIELDS.some((k) => (r[k] ?? "").toUpperCase().includes(q))),
  );
}

export type HourlySortKey = keyof HourlyRow;

/** A stable sort on one column; null values last in both directions. */
export function sortHourlyRows<R extends HourlyRow>(rows: R[], key: HourlySortKey, dir: "asc" | "desc"): R[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const x = a[key];
      const y = b[key];
      if (x === null || x === undefined) return y === null || y === undefined ? ai - bi : 1;
      if (y === null || y === undefined) return -1;
      const c = Array.isArray(x) ? String(x).localeCompare(String(y)) : x < y ? -1 : x > y ? 1 : 0;
      return c ? c * sign : ai - bi;
    })
    .map(([r]) => r);
}

/** FR-59 / NFR-05: `limit` 1–500. */
export function pageOf<R>(rows: R[], page: number, limit: number) {
  const l = Math.min(500, Math.max(1, Math.floor(limit) || 1));
  const p = Math.max(1, Math.floor(page) || 1);
  return { page: p, limit: l, total: rows.length, items: rows.slice((p - 1) * l, p * l) };
}

export type FacetField = "sheet" | "region" | "office" | "alarmName" | "siteType" | "category" | "vip";

/** FR-59: value counts per field, most frequent first; null values are left out. */
export function hourlyFacets(rows: HourlyRow[], fields: FacetField[]) {
  const out: Partial<Record<FacetField, { value: string; count: number }[]>> = {};
  for (const field of fields) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[field];
      if (v === null || v === undefined || v === "") continue;
      const k = String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    out[field] = [...counts]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return out;
}
