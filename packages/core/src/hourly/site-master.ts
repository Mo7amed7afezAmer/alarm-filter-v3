// FR-65 / FR-66: Site Master workbook rows → site_master records. Browser-safe; the caller reads
// the workbook (SheetJS) and passes raw cell values keyed by header.
import { SITE_CODE_RE } from "../classify/site-code";
import { baseNormalize } from "./normalize";
import { regionOf, type SheetRows, type SiteMasterRecord } from "./types";

export type SiteMasterSkipReason = "INVALID_CODE" | "DUPLICATE_CODE" | "EMPTY_OFFICE";

export interface SiteMasterImport {
  records: SiteMasterRecord[];
  skipped: number;
  /** `row` is the 1-based sheet row (the header is row 1). */
  skippedRows: { row: number; reason: SiteMasterSkipReason }[];
}

/** Headers are matched ignoring case, spaces and punctuation. */
const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const COLS = {
  code: ["code", "sitecode"],
  siteName: ["sitename"],
  office: ["office"],
  nodality: ["nodality"],
  vip: ["vip"],
  siteType: ["sitetype"],
  powerSource: ["powersource"],
  battery: ["battery"],
  notes: ["notes"],
  /** FR-66 */
  phone: ["guardnumber", "guardphone", "phone", "phonenumber", "mobile", "contact"],
} as const;

/** FR-65: the sheet named `SiteMaster`, else one whose name matches, else the first sheet. */
export function pickSiteMasterSheet(names: string[]): string | undefined {
  return names.find((n) => n === "SiteMaster") ?? names.find((n) => key(n).includes("sitemaster")) ?? names[0];
}

/** FR-65: VIP is `y|yes|true|1|vip`. */
export function vipOf(value: unknown): boolean {
  return /^(y|yes|true|1|vip)$/i.test(String(value ?? "").trim());
}

/** FR-66: numbers of all phone cells; a numeric cell gets back the leading 0 Excel dropped; joined with " / ". */
export function phoneText(values: unknown[]): string | null {
  const out: string[] = [];
  for (const v of values) {
    const parts =
      typeof v === "number" && Number.isFinite(v)
        ? [`0${Math.round(v)}`]
        : String(v ?? "")
            .split(/[/,;\n]/)
            .map((p) => p.trim());
    for (const p of parts) if (p && !out.includes(p)) out.push(p);
  }
  return out.length ? out.join(" / ") : null;
}

function text(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export function parseSiteMaster(sheets: SheetRows): SiteMasterImport {
  const name = pickSiteMasterSheet(Object.keys(sheets));
  const rows = name ? (sheets[name] ?? []) : [];
  const records: SiteMasterRecord[] = [];
  const skippedRows: SiteMasterImport["skippedRows"] = [];
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const cells = new Map<string, unknown>();
    for (const [h, v] of Object.entries(raw)) cells.set(key(h), v);
    const first = (names: readonly string[]) => names.map((n) => cells.get(n)).find((v) => text(v) !== null);
    const row = i + 2;

    const code = String(first(COLS.code) ?? "")
      .trim()
      .toUpperCase();
    if (!SITE_CODE_RE.test(code)) return skippedRows.push({ row, reason: "INVALID_CODE" });
    if (seen.has(code)) return skippedRows.push({ row, reason: "DUPLICATE_CODE" });
    seen.add(code);
    const office = baseNormalize(String(first(COLS.office) ?? ""));
    if (!office) return skippedRows.push({ row, reason: "EMPTY_OFFICE" });

    records.push({
      code,
      siteName: text(first(COLS.siteName)),
      office,
      nodality: text(first(COLS.nodality)),
      vip: vipOf(first(COLS.vip)),
      siteType: text(first(COLS.siteType)),
      powerSource: text(first(COLS.powerSource)),
      battery: text(first(COLS.battery)),
      phone: phoneText(COLS.phone.map((n) => cells.get(n))),
      region: regionOf(code),
      notes: text(first(COLS.notes)),
    });
  });

  return { records, skipped: skippedRows.length, skippedRows };
}
