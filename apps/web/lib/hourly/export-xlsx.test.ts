import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HourlyRow } from "@alarm/core";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, HOURLY_COLUMNS, OFFICE_PALETTE } from "./columns";
import { buildHourlyXlsx } from "./export-xlsx";

// FR-60 against samples/hourly/golden-export.json (decided 2026-10-17: default columns, office palette).
const dir = fileURLToPath(new URL("../../../../samples/hourly/", import.meta.url));
const reference = JSON.parse(readFileSync(dir + "reference-output.json", "utf8")) as { rows: HourlyRow[] };
const golden = JSON.parse(readFileSync(dir + "golden-export.json", "utf8")) as {
  sheetName: string;
  palette: string[];
  defaultColumns: string[];
  exports: {
    name: string;
    selection: string;
    columns: string[];
    header: string[];
    rows: (string | number | null)[][];
    fills: (string | null)[];
  }[];
};

const SELECTIONS: Record<string, (r: HourlyRow) => boolean> = {
  "all rows": () => true,
  "rows with clockInvalid": (r) => r.clockInvalid,
  "office KAFR EL DAWAR and category POWER": (r) => r.office === "KAFR EL DAWAR" && r.category === "POWER",
};

describe("hourly export columns", () => {
  it("uses the decided default columns and palette", () => {
    expect(DEFAULT_COLUMNS).toEqual(golden.defaultColumns);
    expect(OFFICE_PALETTE).toEqual(golden.palette);
  });

  it("knows every column of the golden exports", () => {
    for (const e of golden.exports) for (const c of e.columns) expect(HOURLY_COLUMNS[c as keyof typeof HOURLY_COLUMNS], c).toBeDefined();
  });
});

describe("buildHourlyXlsx (FR-60)", () => {
  it.each(golden.exports.map((e) => [e.name, e] as const))("%s matches the golden file row for row", async (_name, e) => {
    const rows = reference.rows.filter(SELECTIONS[e.selection]!);
    const bytes = await buildHourlyXlsx(rows, e.columns as (keyof typeof HOURLY_COLUMNS)[]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([golden.sheetName]);
    const ws = wb.worksheets[0]!;

    // Frozen bold header with an autofilter over the header row.
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const header = ws.getRow(1);
    expect(e.header.map((_h, i) => header.getCell(i + 1).value)).toEqual(e.header);
    expect(header.getCell(1).font?.bold).toBe(true);
    // ExcelJS reads the autofilter back as a range: A1 to the last header cell.
    expect(ws.autoFilter).toBe(`A1:${ws.getColumn(e.header.length).letter}1`);

    expect(ws.rowCount).toBe(e.rows.length + 1);
    for (let i = 0; i < e.rows.length; i++) {
      const row = ws.getRow(i + 2);
      const values = e.header.map((_h, c) => {
        const v = row.getCell(c + 1).value;
        return v === undefined || v === "" ? null : v;
      });
      expect(values, `row ${i + 2}`).toEqual(e.rows[i]);
      const fill = row.getCell(1).fill as { fgColor?: { argb?: string } } | undefined;
      expect(fill?.fgColor?.argb ?? null, `fill of row ${i + 2}`).toBe(e.fills[i] ? `FF${e.fills[i]}` : null);
    }
  });
});
