// P7-T06 (FR-63): the web's image options and pages (apps/web/lib/hourly/images.ts); the phone draws
// each page as a view and captures it with react-native-view-shot.
import type { HourlyRow } from "@alarm/core";
import type { HourlyColumn } from "./columns";

export const ROWS_PER_IMAGE = [25, 40, 60, 100] as const;
export const DEFAULT_ROWS_PER_IMAGE = 40;
export const COMPACT_COLUMNS: HourlyColumn[] = ["siteCode", "siteName", "alarmName", "alarmTime", "office"];

/** Splits rows into image pages (per category first when asked). */
export function imagePages(rows: HourlyRow[], rowsPerImage: number, perCategory: boolean) {
  const groups = perCategory
    ? (["DOWN", "POWER", "OTHER"] as const)
        .map((c) => ({ label: c, rows: rows.filter((r) => r.category === c) }))
        .filter((g) => g.rows.length)
    : [{ label: "ALL", rows }];
  return groups.flatMap((g) => {
    const pages = Math.max(1, Math.ceil(g.rows.length / rowsPerImage));
    return Array.from({ length: pages }, (_, i) => ({
      label: g.label,
      page: i + 1,
      pages,
      rows: g.rows.slice(i * rowsPerImage, (i + 1) * rowsPerImage),
    }));
  });
}

export type ImagePage = ReturnType<typeof imagePages>[number];
