import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diffHourly, type HourlyRow } from "@alarm/core";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as web from "../../web/lib/hourly/columns";
import { DEFAULT_COLUMNS, HOURLY_COLUMNS, OFFICE_PALETTE, type HourlyColumn } from "./export/columns";
import { COMPACT_COLUMNS, DEFAULT_ROWS_PER_IMAGE, imagePages, ROWS_PER_IMAGE } from "./export/images";
import { buildHourlyXlsx, HOURLY_SHEET_NAME } from "./export/xlsx";
import { REPORT_FILE_PREFIX, shareCapture, shareXlsx, sweepReportFiles, type Share, type TempFiles } from "./files";
import { HourlyReports } from "./hourly";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

const dir = fileURLToPath(new URL("../../../samples/hourly/", import.meta.url));
const reference = JSON.parse(await readFile(dir + "reference-output.json", "utf8")) as { rows: HourlyRow[] };
const golden = JSON.parse(await readFile(dir + "golden-export.json", "utf8")) as {
  sheetName: string;
  palette: string[];
  defaultColumns: string[];
  exports: {
    name: string;
    selection: string;
    columns: HourlyColumn[];
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

/** FileSystem.cacheDirectory stand-in: a real directory, file:// URIs like expo-file-system. */
let cache: string;
const files: TempFiles = {
  write: async (name, bytes) => {
    await writeFile(join(cache, name), bytes);
    return pathToFileURL(join(cache, name)).href;
  },
  remove: (uri) => rm(fileURLToPath(uri), { force: true }),
  list: async () => readdirSync(cache).map((name) => ({ name, uri: pathToFileURL(join(cache, name)).href })),
};
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "noc-cache-"));
});
afterEach(() => rmSync(cache, { recursive: true, force: true }));

// P7-T06 (FR-60): the same workbook as the web (ExcelJS, decided at Stage 11).
describe("Excel export on the phone (P7-T06, FR-60)", () => {
  it("uses the web's columns, default columns and office palette", () => {
    expect(DEFAULT_COLUMNS).toEqual(golden.defaultColumns);
    expect(OFFICE_PALETTE).toEqual(golden.palette);
    expect(Object.keys(HOURLY_COLUMNS)).toEqual(Object.keys(web.HOURLY_COLUMNS));
    for (const c of Object.keys(HOURLY_COLUMNS) as HourlyColumn[]) {
      expect(HOURLY_COLUMNS[c].header, c).toBe(web.HOURLY_COLUMNS[c].header);
      expect(reference.rows.map(HOURLY_COLUMNS[c].value), c).toEqual(reference.rows.map(web.HOURLY_COLUMNS[c].value));
    }
  });

  it.each(golden.exports.map((e) => [e.name, e] as const))("%s matches the web golden file row for row", async (_name, e) => {
    const bytes = await buildHourlyXlsx(reference.rows.filter(SELECTIONS[e.selection]!), e.columns);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([golden.sheetName]);
    expect(HOURLY_SHEET_NAME).toBe(golden.sheetName);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const header = ws.getRow(1);
    expect(e.header.map((_h, i) => header.getCell(i + 1).value)).toEqual(e.header);
    expect(header.getCell(1).font?.bold).toBe(true);
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

// P7-T06: temp file → expo-sharing → deleted in finally once the share sheet has closed.
describe("share and clean up (P7-T06)", () => {
  it("shares the .xlsx from the cache directory and leaves no report file after the share sheet closes", async () => {
    let seen: string[] = [];
    const share = vi.fn<Share>(async () => {
      seen = readdirSync(cache);
    });
    await shareXlsx(files, share, "msg 1/2", reference.rows, DEFAULT_COLUMNS);
    expect(seen).toEqual([`${REPORT_FILE_PREFIX}msg_1_2.xlsx`]);
    expect(share).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/.*hourly-msg_1_2\.xlsx$/), {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      UTI: "org.openxmlformats.spreadsheetml.sheet",
      dialogTitle: "Share hourly report",
    });
    expect(readdirSync(cache)).toEqual([]);
  });

  it("deletes the file when sharing fails or is cancelled, and passes the error on", async () => {
    const fail: Share = async () => Promise.reject(new Error("share cancelled"));
    await expect(shareXlsx(files, fail, "a", reference.rows, DEFAULT_COLUMNS)).rejects.toThrow("share cancelled");
    expect(readdirSync(cache)).toEqual([]);
  });

  it("shares a captured image (view-shot tmpfile) as PNG and deletes it, also on failure", async () => {
    const capture = async () => {
      writeFileSync(join(cache, "hourly-a-DOWN-1.png"), "png");
      return pathToFileURL(join(cache, "hourly-a-DOWN-1.png")).href;
    };
    const share = vi.fn<Share>(async () => undefined);
    await shareCapture(files, share, capture);
    expect(share).toHaveBeenCalledWith(expect.stringMatching(/hourly-a-DOWN-1\.png$/), {
      mimeType: "image/png",
      UTI: "public.png",
      dialogTitle: "Share hourly image",
    });
    expect(readdirSync(cache)).toEqual([]);
    await expect(shareCapture(files, async () => Promise.reject(new Error("no app")), capture)).rejects.toThrow("no app");
    expect(readdirSync(cache)).toEqual([]);
  });

  it("sweeps report files left behind (e.g. the app was killed during a share), and nothing else", async () => {
    writeFileSync(join(cache, "hourly-x.xlsx"), "x");
    writeFileSync(join(cache, "hourly-x-ALL-1.png"), "x");
    writeFileSync(join(cache, "other.db"), "x");
    await sweepReportFiles(files);
    expect(readdirSync(cache)).toEqual(["other.db"]);
  });
});

// FR-63 on the phone: the web's image pages.
describe("image pages (P7-T06, FR-63)", () => {
  it("has the web's options: 25/40/60/100 rows, default 40, compact columns", () => {
    expect(ROWS_PER_IMAGE).toEqual([25, 40, 60, 100]);
    expect(DEFAULT_ROWS_PER_IMAGE).toBe(40);
    expect(COMPACT_COLUMNS).toEqual(["siteCode", "siteName", "alarmName", "alarmTime", "office"]);
  });

  it("splits per category by default, in DOWN, POWER, OTHER order, and pages by rows per image", () => {
    const pages = imagePages(reference.rows, 40, true);
    const byCat = (c: string) => reference.rows.filter((r) => r.category === c);
    expect([...new Set(pages.map((p) => p.label))]).toEqual(["DOWN", "POWER", "OTHER"].filter((c) => byCat(c).length));
    for (const c of ["DOWN", "POWER", "OTHER"]) {
      const ps = pages.filter((p) => p.label === c);
      expect(ps.flatMap((p) => p.rows)).toEqual(byCat(c));
      expect(ps.every((p) => p.rows.length <= 40 && p.pages === ps.length)).toBe(true);
    }
    const all = imagePages(reference.rows, 100, false);
    expect(all.every((p) => p.label === "ALL")).toBe(true);
    expect(all).toHaveLength(Math.ceil(reference.rows.length / 100));
  });
});

// FR-61 on the phone: both reports from memory, compared on the device.
describe("compare on the phone (P7-T06, FR-61)", () => {
  const rows = reference.rows;
  const older = rows.slice(0, rows.length - 5);
  const newer = rows.slice(5);
  const reports = () => {
    const r = new HourlyReports({ get: vi.fn(), request: vi.fn() } as never, async () => undefined);
    vi.spyOn(r, "open").mockImplementation(async (id: string) => ({ id, rows: id === "old" ? older : newer, stats: {} as never, ms: 0 }));
    return r;
  };

  it("gives core's new and disappeared rows (code|alarmName|dn)", async () => {
    expect(await reports().compare("old", "new")).toEqual(diffHourly(older, newer));
  });

  it("refuses the same report twice", async () => {
    await expect(reports().compare("old", "old")).rejects.toThrow("Choose two different reports.");
  });
});
