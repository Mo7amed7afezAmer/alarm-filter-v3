import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSiteMaster, phoneText, pickSiteMasterSheet, vipOf, type SiteMasterRecord } from "./index";
import { siteMaster } from "./test-helpers";

// FR-65 / FR-66: Site Master workbook rows → site_master records (G-T15).
const header = (r: SiteMasterRecord) => ({
  Code: r.code,
  "Site Name": r.siteName ?? "",
  Office: r.office ?? "",
  Nodality: r.nodality ?? "",
  VIP: r.vip ? "Yes" : "No",
  "Site Type": r.siteType ?? "",
  "Power Source": r.powerSource ?? "",
  Battery: r.battery ?? "",
  Phone: r.phone ?? "",
  Notes: r.notes ?? "",
});

describe("pickSiteMasterSheet (FR-65)", () => {
  it("prefers the sheet named SiteMaster", () => {
    expect(pickSiteMasterSheet(["Summary", "Site Master list", "SiteMaster"])).toBe("SiteMaster");
  });
  it("else a sheet whose name matches", () => {
    expect(pickSiteMasterSheet(["Summary", "site_master 2026"])).toBe("site_master 2026");
  });
  it("else the first sheet", () => {
    expect(pickSiteMasterSheet(["Sheet1", "Sheet2"])).toBe("Sheet1");
  });
  it("undefined for an empty workbook", () => {
    expect(pickSiteMasterSheet([])).toBeUndefined();
  });
});

describe("vipOf (FR-65)", () => {
  it.each(["y", "Y", "yes", "YES", "true", "1", "vip", " Vip ", true, 1])("%s → true", (v) => expect(vipOf(v)).toBe(true));
  it.each(["n", "no", "false", "0", "", null, undefined, false, 0, "VIP site"])("%s → false", (v) => expect(vipOf(v)).toBe(false));
});

describe("phoneText (FR-66)", () => {
  it("restores the leading 0 Excel drops from a numeric cell", () => {
    expect(phoneText([1001234567])).toBe("01001234567");
  });
  it("keeps a text cell as typed", () => {
    expect(phoneText(["01001234567"])).toBe("01001234567");
  });
  it("joins several numbers with ' / ' and drops repeats", () => {
    expect(phoneText([1001234567, "01112223334 / 01001234567", "", null])).toBe("01001234567 / 01112223334");
  });
  it("splits a cell on / , ; and new lines", () => {
    expect(phoneText(["0100 / 0111,0122;0155\n0128"])).toBe("0100 / 0111 / 0122 / 0155 / 0128");
  });
  it("null when no column has a number", () => {
    expect(phoneText(["", null, undefined, "  "])).toBeNull();
  });
});

describe("parseSiteMaster (FR-65, FR-66)", () => {
  it("samples/hourly/site-master.json: 136 sites, 2 skipped (code 0970DE repeated; FR-65)", () => {
    const out = parseSiteMaster({ SiteMaster: siteMaster.map(header) });
    expect(siteMaster).toHaveLength(138);
    expect(out.records).toHaveLength(136);
    expect(out.skipped).toBe(2);
    expect(out.skippedRows).toEqual([
      { row: 38, reason: "DUPLICATE_CODE" },
      { row: 48, reason: "DUPLICATE_CODE" },
    ]);
    const first = out.records[0]!;
    const src = siteMaster[0]!;
    expect(first.code).toBe(src.code);
    expect(first.office).toBe(src.office);
    expect(first.vip).toBe(src.vip);
    expect(first.region).toBe(src.code.slice(-2));
  });

  it("skips an invalid code, a code repeated in the file and an empty office", () => {
    const out = parseSiteMaster({
      Sheet1: [
        { Code: "0444DE", Office: "Kafr ElDawar" },
        { Code: "bad code", Office: "Kafr ElDawar" },
        { Code: "0444DE", Office: "Other" },
        { Code: "0555DE", Office: "  " },
        { Code: "", Office: "Kafr ElDawar" },
      ],
    });
    expect(out.records.map((r) => r.code)).toEqual(["0444DE"]);
    expect(out.records[0]!.office).toBe("KAFR ELDAWAR");
    expect(out.skipped).toBe(4);
    expect(out.skippedRows.map((s) => s.reason)).toEqual(["INVALID_CODE", "DUPLICATE_CODE", "EMPTY_OFFICE", "INVALID_CODE"]);
    expect(out.skippedRows.map((s) => s.row)).toEqual([3, 4, 5, 6]);
  });

  it("upper-cases and trims the code; base-normalizes the office; region from the code", () => {
    const [r] = parseSiteMaster({ SiteMaster: [{ " code ": " 0444de ", OFFICE: "  kafr   eldawar " }] }).records;
    expect(r).toMatchObject({ code: "0444DE", office: "KAFR ELDAWAR", region: "DE", vip: false });
  });

  it("matches headers ignoring case, spaces and punctuation; Site Code is accepted for Code", () => {
    const [r] = parseSiteMaster({
      SiteMaster: [
        {
          "SITE CODE": "0444DE",
          office: "X",
          site_name: "Kafr",
          "Power-Source": "Mains",
          "site type": "Macro",
          NODALITY: "1+0",
          battery: "4h",
          notes: "gate",
          VIP: "vip",
        },
      ],
    }).records;
    expect(r).toMatchObject({
      siteName: "Kafr",
      powerSource: "Mains",
      siteType: "Macro",
      nodality: "1+0",
      battery: "4h",
      notes: "gate",
      vip: true,
    });
  });

  it.each(["Guard Number", "Guard Phone", "Phone", "Phone Number", "Mobile", "Contact"])("reads the phone from %s (FR-66)", (col) => {
    const [r] = parseSiteMaster({ SiteMaster: [{ Code: "0444DE", Office: "X", [col]: 1001234567 }] }).records;
    expect(r!.phone).toBe("01001234567");
  });

  it("joins the numbers of several phone columns", () => {
    const [r] = parseSiteMaster({
      SiteMaster: [{ Code: "0444DE", Office: "X", "Guard Number": 1001234567, Mobile: "01112223334" }],
    }).records;
    expect(r!.phone).toBe("01001234567 / 01112223334");
  });

  it("empty optional cells become null", () => {
    const [r] = parseSiteMaster({ SiteMaster: [{ Code: "0444DE", Office: "X", "Site Name": " ", Battery: "" }] }).records;
    expect(r).toMatchObject({ siteName: null, battery: null, nodality: null, phone: null, notes: null });
  });

  it("an empty workbook gives nothing", () => {
    expect(parseSiteMaster({})).toEqual({ records: [], skipped: 0, skippedRows: [] });
  });
});

// The original Site Master workbook (tests/fixtures, files only): FR-65 "136 inserted / 2 skipped".
const original = fileURLToPath(new URL("../../../../tests/fixtures/SiteMaster_KafrElDawar.xlsx", import.meta.url));
describe.skipIf(!existsSync(original))("tests/fixtures/SiteMaster_KafrElDawar.xlsx (FR-65)", () => {
  it("gives 136 sites and skips the 2 repeated codes", () => {
    const book = XLSX.read(readFileSync(original), { type: "buffer" });
    const sheets = Object.fromEntries(
      book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[n]!, { raw: true, defval: "" })]),
    );
    const out = parseSiteMaster(sheets);
    expect(out.records).toHaveLength(136);
    expect(out.skippedRows).toEqual([
      { row: 38, reason: "DUPLICATE_CODE" },
      { row: 48, reason: "DUPLICATE_CODE" },
    ]);
    expect(out.records.find((r) => r.code === "0200DE")).toMatchObject({ office: "KAFR EL DAWAR", phone: "01068200827", region: "DE" });
  });
});
