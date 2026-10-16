// Hourly report rows (FR-53 … FR-56; row shape decided 2026-10-17). Browser-safe.
import type { Category } from "../classify";

/** FR-53: the sheets read, in order; `All` is never read. */
export const HOURLY_SHEETS = ["2G_Down", "3G_Down", "4G_Down", "5G_Down", "Environmental", "HW"] as const;
export type HourlySheet = (typeof HOURLY_SHEETS)[number];

/** A workbook as `{ sheet name: rows keyed by header }` (e.g. SheetJS `sheet_to_json(raw: true)`). */
export type SheetRows = Record<string, Record<string, unknown>[]>;

export interface HourlyRow {
  sheet: HourlySheet;
  /** 2G/3G/4G/5G of the *_Down sheets that held this alarm (FR-53). */
  technologies: string[];
  alarmNumber: string;
  alarmType: string;
  /** Wall clock as in the report, `YYYY-MM-DD HH:mm:ss` (FR-54). */
  alarmTime: string;
  /** Year before 2020 (FR-54). */
  clockInvalid: boolean;
  alarmText: string;
  alarmName: string;
  supplementaryInfo: string;
  dn: string;
  objectClass: string;
  siteName: string;
  siteCode: string;
  siteAddress: string;
  diagnosticInfo: string;
  userInfo: string;
  // FR-55 enrichment
  office: string | null;
  nodality: string | null;
  vip: boolean | null;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  phone: string | null;
  region: string | null;
  category: Category;
}

/** A site_master row as the browser receives it. */
export interface SiteMasterRecord {
  code: string;
  siteName?: string | null;
  office: string | null;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  phone: string | null;
  region?: string | null;
  notes?: string | null;
}

/** FR-55: region = last 2 characters of the site code. */
export function regionOf(siteCode: string): string | null {
  return siteCode.length >= 2 ? siteCode.slice(-2) : null;
}

const POWER = /RECTIFIER|MAIN POWER|BATTERY|GENERATOR|SURGE/;

/** FR-55: *_Down → DOWN; Environmental with a power word → POWER; else OTHER. */
export function hourlyCategory(row: { sheet: string; alarmName: string }): Category {
  if (row.sheet.endsWith("_Down")) return "DOWN";
  if (row.sheet === "Environmental" && POWER.test(row.alarmName.toUpperCase())) return "POWER";
  return "OTHER";
}
