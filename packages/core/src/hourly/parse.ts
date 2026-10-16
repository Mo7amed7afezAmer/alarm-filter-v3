// FR-53 / FR-54: read the hourly sheets, dedupe *_Down rows, keep Alarm Time as wall clock.
import { HOURLY_SHEETS, type HourlyRow, type HourlySheet, type SheetRows } from "./types";
import { HourlyReportError } from "./validate";

/** FR-53: columns every hourly sheet must have. */
export const REQUIRED_COLUMNS = ["Alarm Time", "Alarm Text", "Distinguished Name", "Site Code"];

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * FR-54: wall-clock text `YYYY-MM-DD HH:mm:ss` — an Excel serial (days since 1899-12-30) is
 * rounded to the second with no time-zone conversion; text is kept as written.
 */
export function wallClock(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let t: Date;
  if (value instanceof Date) t = value;
  else if (typeof value === "number") t = new Date(EXCEL_EPOCH + Math.round(value * 86_400) * 1000);
  else return String(value).trim();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

type ParsedRow = Omit<HourlyRow, "office" | "nodality" | "vip" | "siteType" | "powerSource" | "battery" | "phone" | "region" | "category">;

export function parseReport(sheets: SheetRows): ParsedRow[] {
  const out: ParsedRow[] = [];
  const down = new Map<string, ParsedRow>();

  for (const sheet of HOURLY_SHEETS) {
    const data = sheets[sheet];
    if (!data) continue;
    if (data.length) {
      const missing = REQUIRED_COLUMNS.filter((c) => !(c in data[0]!));
      if (missing.length) throw new HourlyReportError("MISSING_COLUMNS", `sheet ${sheet} lacks the column(s) ${missing.join(", ")}`);
    }
    for (const r of data) {
      const alarmText = text(r["Alarm Text"]);
      const dn = text(r["Distinguished Name"]);
      const alarmTime = wallClock(r["Alarm Time"]);
      if (!alarmTime && !alarmText && !dn) continue;
      const supplementaryInfo = text(r["Supplementary Information"]);
      const year = /^\d{4}/.test(alarmTime) ? Number(alarmTime.slice(0, 4)) : null;
      const row: ParsedRow = {
        sheet: sheet as HourlySheet,
        technologies: [],
        alarmNumber: text(r["Alarm Number"]),
        alarmType: text(r["Alarm Type"]),
        alarmTime,
        clockInvalid: year !== null && year < 2020,
        alarmText,
        // FR-54: Environmental names come from Supplementary Information, falling back to Alarm Text.
        alarmName: sheet === "Environmental" ? supplementaryInfo || alarmText : alarmText,
        supplementaryInfo,
        dn,
        objectClass: text(r["Object Class"]),
        siteName: text(r["Site Name"]),
        siteCode: text(r["Site Code"]).toUpperCase(),
        siteAddress: text(r["Site Address"]),
        diagnosticInfo: text(r["Diagnostic Info"]),
        userInfo: text(r["User Additional Information"]),
      };
      if (sheet.endsWith("_Down")) {
        const tech = sheet.split("_")[0]!;
        const key = `${dn}\u0000${alarmText}\u0000${alarmTime}`;
        const first = down.get(key);
        if (first) {
          if (!first.technologies.includes(tech)) first.technologies.push(tech);
          continue;
        }
        row.technologies = [tech];
        down.set(key, row);
      }
      out.push(row);
    }
  }
  return out;
}
