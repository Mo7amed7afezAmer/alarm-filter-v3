// Test-only helpers (not exported from the package): read samples/hourly/ the way the browser does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import type { HourlyRow, SiteMasterRecord, SheetRows } from "./index";

export const hourlyDir = fileURLToPath(new URL("../../../../samples/hourly/", import.meta.url));

/** The workbook as SheetJS gives it to the browser: raw cell values keyed by header. */
export function readWorkbook(file = "nsn-update-output.xlsx"): SheetRows {
  const wb = XLSX.read(readFileSync(hourlyDir + file), { type: "buffer" });
  return Object.fromEntries(
    wb.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]!, { raw: true, defval: "" })]),
  );
}

export const siteMaster = JSON.parse(readFileSync(hourlyDir + "site-master.json", "utf8")) as SiteMasterRecord[];

export const reference = JSON.parse(readFileSync(hourlyDir + "reference-output.json", "utf8")) as {
  stats: {
    rows: number;
    unmatched: number;
    emptyCodes: number;
    bySheet: Record<string, number>;
    byCategory: Record<string, number>;
    clockInvalid: number;
    multiTechnology: number;
  };
  rows: HourlyRow[];
};
