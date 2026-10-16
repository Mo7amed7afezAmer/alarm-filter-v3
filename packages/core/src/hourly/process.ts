// The hourly pipeline: parse (FR-53, FR-54) → enrich (FR-55) → normalize (FR-56) → category (FR-55).
import { enrichRows } from "./enrich";
import { compileNormalizer, type NormalizationRule } from "./normalize";
import { parseReport } from "./parse";
import { HOURLY_SHEETS, hourlyCategory, type HourlyRow, type SheetRows, type SiteMasterRecord } from "./types";

export interface HourlyStats {
  rows: number;
  unmatched: number;
  emptyCodes: number;
  bySheet: Record<string, number>;
  byCategory: Record<string, number>;
  clockInvalid: number;
  multiTechnology: number;
}

export function processWorkbook(sheets: SheetRows, siteMaster: SiteMasterRecord[], rules: NormalizationRule[]) {
  const enriched = enrichRows(parseReport(sheets), siteMaster);
  const normalize = compileNormalizer(rules);
  const rows: HourlyRow[] = enriched.rows.map((r) => {
    const n = normalize(r);
    return { ...n, category: hourlyCategory(n) };
  });
  const count = (pred: (r: HourlyRow) => boolean) => rows.filter(pred).length;
  const stats: HourlyStats = {
    rows: rows.length,
    unmatched: enriched.unmatched,
    emptyCodes: enriched.emptyCodes,
    bySheet: Object.fromEntries(HOURLY_SHEETS.map((s) => [s, count((r) => r.sheet === s)])),
    byCategory: Object.fromEntries((["DOWN", "POWER", "OTHER"] as const).map((c) => [c, count((r) => r.category === c)])),
    clockInvalid: count((r) => r.clockInvalid),
    multiTechnology: count((r) => r.technologies.length > 1),
  };
  return { rows, stats };
}
