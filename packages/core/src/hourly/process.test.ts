import { describe, expect, it } from "vitest";
import { HOURLY_SHEETS, HourlyReportError, parseReport, processWorkbook, wallClock } from "./index";
import { readWorkbook, reference, siteMaster } from "./test-helpers";

// FR-53 … FR-56 on the real report against samples/hourly/reference-output.json (approved 2026-10-17).
describe("processWorkbook on the real report", () => {
  const sheets = readWorkbook();
  const result = processWorkbook(sheets, siteMaster, []);

  it("matches the reference rows, field by field", () => {
    expect(result.rows).toHaveLength(reference.rows.length);
    for (let i = 0; i < reference.rows.length; i++) expect(result.rows[i], `row ${i}`).toEqual(reference.rows[i]);
  });

  it("matches the reference stats", () => {
    expect(result.stats).toEqual(reference.stats);
  });
});

describe("parseReport (FR-53, FR-54)", () => {
  const sheets = readWorkbook();

  it("reads the six hourly sheets and never All", () => {
    expect(HOURLY_SHEETS).toEqual(["2G_Down", "3G_Down", "4G_Down", "5G_Down", "Environmental", "HW"]);
    const rows = parseReport(sheets);
    expect(new Set(rows.map((r) => r.sheet))).not.toContain("All");
    expect(rows.length).toBeLessThan(sheets.All!.length);
  });

  it("dedupes *_Down rows on (DN, Alarm Text, Alarm Time) and collects technologies", () => {
    const rows = parseReport(sheets);
    const multi = rows.filter((r) => r.technologies.length > 1);
    expect(multi).toHaveLength(reference.stats.multiTechnology);
    expect(multi.every((r) => r.sheet.endsWith("_Down"))).toBe(true);
    const keys = rows.filter((r) => r.sheet.endsWith("_Down")).map((r) => `${r.dn}|${r.alarmText}|${r.alarmTime}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("takes the Environmental alarm name from Supplementary Information, falling back to Alarm Text", () => {
    const env = { Environmental: [row({ "Supplementary Information": "RECTIFIER MINOR ALARM" }), row({ "Supplementary Information": "" })] };
    const [a, b] = parseReport(env);
    expect(a!.alarmName).toBe("RECTIFIER MINOR ALARM");
    expect(b!.alarmName).toBe("BASE STATION EXTERNAL ALARM NOTIFICATION");
  });

  it("uses Alarm Text as the alarm name on the other sheets", () => {
    const [r] = parseReport({ HW: [row({ "Alarm Text": "BASE STATION HARDWARE PROBLEM", "Supplementary Information": "X" })] });
    expect(r!.alarmName).toBe("BASE STATION HARDWARE PROBLEM");
  });

  it("skips empty rows and missing sheets", () => {
    const rows = parseReport({ HW: [row({}), { "Alarm Time": "", "Alarm Text": "", "Distinguished Name": "", "Site Code": "" }] });
    expect(rows).toHaveLength(1);
  });

  it("fails clearly when a sheet lacks a required column", () => {
    const bad = { HW: [{ "Alarm Time": 46308.29, "Alarm Text": "X", "Site Code": "0444DE" }] };
    const err = (() => {
      try {
        parseReport(bad);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(HourlyReportError);
    expect((err as HourlyReportError).code).toBe("MISSING_COLUMNS");
    expect((err as Error).message).toContain("Distinguished Name");
  });

  it("keeps Alarm Time as wall-clock text and flags years before 2020 (FR-54)", () => {
    const [ok, old, text] = parseReport({
      HW: [row({ "Alarm Time": 46308.293240740735 }), row({ "Alarm Time": 37987.08401620371 }), row({ "Alarm Time": "13/10/2026 07:02" })],
    });
    expect(ok!).toMatchObject({ alarmTime: "2026-10-13 07:02:16", clockInvalid: false });
    expect(old!).toMatchObject({ alarmTime: "2004-01-01 02:00:59", clockInvalid: true });
    expect(text!).toMatchObject({ alarmTime: "13/10/2026 07:02", clockInvalid: false });
  });
});

describe("wallClock", () => {
  it("rounds an Excel serial to the nearest second, without a time zone", () => {
    expect(wallClock(46308.5)).toBe("2026-10-13 12:00:00");
    expect(wallClock(46308.50001)).toBe("2026-10-13 12:00:01"); // +0.864 s rounds up
    expect(wallClock(46308.500004)).toBe("2026-10-13 12:00:00"); // +0.346 s rounds down
    expect(wallClock(new Date(Date.UTC(2026, 9, 13, 7, 2, 16)))).toBe("2026-10-13 07:02:16");
    expect(wallClock("")).toBe("");
  });
});

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    "Alarm Number": "7103",
    "Alarm Type": "Environmental",
    "Alarm Time": 46308.293240740735,
    "Alarm Text": "BASE STATION EXTERNAL ALARM NOTIFICATION",
    "Distinguished Name": "PLMN-PLMN/MRBTS-22840/EQM_R-1",
    "Object Class": "MRBTS",
    "Site Name": "SRAN_LWG_TDD_S_BH-ALQAM_3337DE",
    "Site Code": "3337DE",
    "Supplementary Information": "",
    ...over,
  };
}
