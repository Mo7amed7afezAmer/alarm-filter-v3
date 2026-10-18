// P7-T04: hourly reports on the phone. Hermes has no WebAssembly, so the server extracts the
// workbook (`…/xlsx`, D-11); the device parses it with SheetJS and the same core pipeline as the
// browser (FR-53 … FR-56), pausing between steps so the UI frame is not blocked.
import {
  diffHourly,
  filterHourlyRows,
  hourlyFacets,
  HOURLY_SHEETS,
  processWorkbook,
  ReportCache,
  type FacetField,
  type HourlyFilter,
  type HourlyRow,
  type HourlyStats,
  type NormalizationRule,
  type SiteMasterRecord,
} from "@alarm/core";
import * as XLSX from "xlsx";
import type { ApiClient } from "./api";

export interface Reference {
  updatedAt: string;
  siteMaster: SiteMasterRecord[];
  normalizations: NormalizationRule[];
}

export interface ProcessedReport {
  id: string;
  rows: HourlyRow[];
  stats: HourlyStats;
  ms: number;
}

export interface ReportListItem {
  id: string;
  subject: string;
  receivedAt: string;
  attachment: { filename: string; size: number } | null;
}

/** GET /api/v1/hourly-reports (FR-47). */
export interface ReportListPage {
  reports: ReportListItem[];
  nextPageToken: string | null;
}

/** Gives the UI a frame between processing steps. */
export type Pause = () => Promise<void>;
export const nextFrame: Pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The web Worker's SheetJS options (apps/web/lib/hourly/worker.ts): values only, six sheets. */
const READ_OPTIONS: XLSX.ParsingOptions = {
  type: "array",
  dense: true,
  cellText: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  sheets: [...HOURLY_SHEETS],
};

/** Workbook bytes → hourly rows, in steps (read, one per sheet, process). */
export async function processXlsxOnDevice(bytes: Uint8Array, ref: Reference, pause: Pause = nextFrame) {
  await pause();
  const book = XLSX.read(bytes, READ_OPTIONS);
  const sheets: Record<string, Record<string, unknown>[]> = {};
  for (const name of book.SheetNames) {
    await pause();
    sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name]!, { raw: true, defval: "" });
  }
  await pause();
  return processWorkbook(sheets, ref.siteMaster, ref.normalizations);
}

/** FR-47: the report list (25 per page, Gmail page token). */
export const reportPath = (pageToken?: string): string =>
  pageToken ? `/api/v1/hourly-reports?${new URLSearchParams({ pageToken })}` : "/api/v1/hourly-reports";

/** FR-62 sheet tabs with row counts, in the fixed sheet order. */
export function sheetTabs(rows: HourlyRow[]): { sheet: string; count: number }[] {
  return HOURLY_SHEETS.map((sheet) => ({ sheet, count: rows.filter((r) => r.sheet === sheet).length }));
}

/** FR-59: the web's multi-select filters (components/hourly-report.tsx), same order. */
export const FILTER_FACETS = [
  { key: "office", field: "office", label: "Office" },
  { key: "region", field: "region", label: "Region" },
  { key: "category", field: "category", label: "Category" },
  { key: "siteType", field: "siteType", label: "Site type" },
  { key: "alarm", field: "alarmName", label: "Alarm" },
] as const satisfies readonly { key: keyof HourlyFilter; field: FacetField; label: string }[];

export type FacetKey = (typeof FILTER_FACETS)[number]["key"];

const inTab = (rows: HourlyRow[], sheet: string | null) => (sheet ? rows.filter((r) => r.sheet === sheet) : rows);

/** Facet values with counts for the open sheet tab, as on the web. */
export const reportFacets = (rows: HourlyRow[], sheet: string | null) =>
  hourlyFacets(
    inTab(rows, sheet),
    FILTER_FACETS.map((f) => f.field),
  );

/** Adds or removes one value of a multi-select filter; an empty list is dropped. */
export function toggleValue(f: HourlyFilter, key: FacetKey, value: string): HourlyFilter {
  const cur = new Set<string>(f[key] ?? []);
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  const next = { ...f } as Record<string, unknown>;
  if (cur.size) next[key] = [...cur];
  else delete next[key];
  return next as HourlyFilter;
}

/** The rows shown for a sheet tab and filter: the web's `filterHourlyRows` on the tab's rows. */
export const visibleRows = (rows: HourlyRow[], sheet: string | null, f: HourlyFilter): HourlyRow[] =>
  filterHourlyRows(inTab(rows, sheet), f);

/** Opened reports, in memory only (3 at most, like the browser); nothing is written to disk. */
export class HourlyReports {
  private readonly cache = new ReportCache<ProcessedReport>();

  constructor(
    private readonly api: Pick<ApiClient, "get" | "request">,
    private readonly pause: Pause = nextFrame,
    private readonly reference: () => Promise<Reference> = () => api.get<Reference>("/api/v1/hourly-reference"),
  ) {}

  get size(): number {
    return this.cache.size;
  }

  async open(id: string): Promise<ProcessedReport> {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const started = Date.now();
    const [res, ref] = await Promise.all([this.api.request(`/api/v1/hourly-reports/${encodeURIComponent(id)}/xlsx`), this.reference()]);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { rows, stats } = await processXlsxOnDevice(bytes, ref, this.pause);
    const report = { id, rows, stats, ms: Date.now() - started };
    this.cache.set(id, report);
    return report;
  }

  /** FR-59 filters on the device; no network. */
  filter(report: ProcessedReport, f: HourlyFilter): HourlyRow[] {
    return filterHourlyRows(report.rows, f);
  }

  /** FR-61 on the device: rows new in `current` and gone since `previous` (core diff). */
  async compare(previous: string, current: string) {
    if (previous === current) throw new Error("Choose two different reports.");
    const [a, b] = await Promise.all([this.open(previous), this.open(current)]);
    return diffHourly(a.rows, b.rows);
  }

  clear(): void {
    this.cache.clear();
  }
}
