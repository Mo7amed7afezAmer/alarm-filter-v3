// P7-T06 (FR-60): apps/web/lib/hourly/export-xlsx.ts on the phone. ExcelJS, because community SheetJS
// writes no fills, bold or frozen panes (decided at Stage 11); Metro takes ExcelJS's browser build.
import type { HourlyRow } from "@alarm/core";
import ExcelJS from "exceljs";
import { HOURLY_COLUMNS, officeFills, type HourlyColumn } from "./columns";

export const HOURLY_SHEET_NAME = "Hourly report";

export async function buildHourlyXlsx(rows: HourlyRow[], columns: HourlyColumn[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(HOURLY_SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });

  const header = ws.addRow(columns.map((c) => HOURLY_COLUMNS[c].header));
  header.font = { bold: true };

  const fills = officeFills(rows);
  for (const r of rows) {
    // Empty text is written as a blank cell.
    const row = ws.addRow(
      columns.map((c) => {
        const v = HOURLY_COLUMNS[c].value(r);
        return v === "" ? null : v;
      }),
    );
    const color = r.office ? fills.get(r.office) : undefined;
    if (color) {
      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
      }
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, HOURLY_COLUMNS[c].header.length + 2));
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
