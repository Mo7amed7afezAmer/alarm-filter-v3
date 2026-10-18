// P7-T06: a copy of apps/web/lib/hourly/columns.ts (packages/core stays unchanged); src/export.test.ts
// checks it against the web file and the golden export.
import type { HourlyRow } from "@alarm/core";

type Cell = string | number | null;

export const HOURLY_COLUMNS = {
  sheet: { header: "Sheet", value: (r: HourlyRow): Cell => r.sheet },
  technologies: { header: "Technologies", value: (r: HourlyRow): Cell => r.technologies.join(", ") || null },
  alarmTime: { header: "Alarm time", value: (r: HourlyRow): Cell => r.alarmTime },
  alarmName: { header: "Alarm name", value: (r: HourlyRow): Cell => r.alarmName },
  alarmText: { header: "Alarm text", value: (r: HourlyRow): Cell => r.alarmText },
  supplementaryInfo: { header: "Supplementary info", value: (r: HourlyRow): Cell => r.supplementaryInfo || null },
  siteName: { header: "Site name", value: (r: HourlyRow): Cell => r.siteName },
  siteCode: { header: "Site code", value: (r: HourlyRow): Cell => r.siteCode || null },
  office: { header: "Office", value: (r: HourlyRow): Cell => r.office },
  region: { header: "Region", value: (r: HourlyRow): Cell => r.region },
  category: { header: "Category", value: (r: HourlyRow): Cell => r.category },
  vip: { header: "VIP", value: (r: HourlyRow): Cell => (r.vip === null ? null : r.vip ? "YES" : "NO") },
  nodality: { header: "Nodality", value: (r: HourlyRow): Cell => r.nodality },
  battery: { header: "Battery", value: (r: HourlyRow): Cell => r.battery },
  phone: { header: "Phone", value: (r: HourlyRow): Cell => r.phone },
  clockInvalid: { header: "Clock invalid", value: (r: HourlyRow): Cell => (r.clockInvalid ? "YES" : null) },
} as const;

export type HourlyColumn = keyof typeof HOURLY_COLUMNS;

/** Decided 2026-10-17. */
export const DEFAULT_COLUMNS: HourlyColumn[] = [
  "sheet",
  "alarmTime",
  "alarmName",
  "siteName",
  "siteCode",
  "office",
  "region",
  "category",
  "vip",
  "nodality",
  "battery",
  "phone",
  "clockInvalid",
];

/** FR-60 / FR-62 office fills: 8 light colours given to the offices in alphabetical order (decided 2026-10-17). */
export const OFFICE_PALETTE = ["FFF2CC", "DDEBF7", "E2EFDA", "FCE4D6", "EDEDED", "D9E1F2", "FFE699", "C6E0B4"];

/** Office → fill colour (RRGGBB) for a set of rows; rows without an office get no fill. */
export function officeFills(rows: Pick<HourlyRow, "office">[]): Map<string, string> {
  const offices = [...new Set(rows.map((r) => r.office).filter((o): o is string => !!o))].sort();
  return new Map(offices.map((o, i) => [o, OFFICE_PALETTE[i % OFFICE_PALETTE.length]!]));
}

export const cellText = (v: Cell) => (v === null ? "" : String(v));
