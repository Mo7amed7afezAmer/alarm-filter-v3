import { describe, expect, it } from "vitest";
import {
  baseNormalize,
  compileNormalizer,
  diffHourly,
  enrichRows,
  hourlyCategory,
  hourlyDiffKey,
  NORMALIZED_FIELDS,
  regionOf,
  type HourlyRow,
} from "./index";
import { reference, siteMaster } from "./test-helpers";

const rows = reference.rows;
const sample = (pred: (r: HourlyRow) => boolean) => rows.find(pred)!;

describe("enrichRows (FR-55)", () => {
  it("fills Site Master fields by site code and counts unmatched and empty codes", () => {
    const bare = rows.map((r) => ({
      ...r,
      office: null,
      nodality: null,
      vip: null,
      siteType: null,
      powerSource: null,
      battery: null,
      phone: null,
    }));
    const out = enrichRows(bare, siteMaster);
    expect(out.unmatched).toBe(reference.stats.unmatched);
    expect(out.emptyCodes).toBe(reference.stats.emptyCodes);
    const matched = out.rows.find((r) => r.siteCode === "0444DE")!;
    const sm = siteMaster.find((s) => s.code === "0444DE")!;
    expect(matched).toMatchObject({ office: sm.office, nodality: sm.nodality, vip: sm.vip, battery: sm.battery, phone: sm.phone });
  });

  it("derives the region from the last 2 characters of the site code", () => {
    expect(regionOf("0444DE")).toBe("DE");
    expect(regionOf("0014AL")).toBe("AL");
    expect(regionOf("")).toBeNull();
  });

  it.each([
    ["2G_Down", "BCCH MISSING", "DOWN"],
    ["4G_Down", "BASE STATION SERVICE PROBLEM", "DOWN"],
    ["Environmental", "RECTIFIER MINOR ALARM", "POWER"],
    ["Environmental", "MAIN POWER CUT OFF", "POWER"],
    ["Environmental", "BATTERY LOW", "POWER"],
    ["Environmental", "GENERATOR FAIL", "POWER"],
    ["Environmental", "SURGE ARRESTER", "POWER"],
    ["Environmental", "FIRE ALARM", "OTHER"],
    ["HW", "BASE STATION HARDWARE PROBLEM", "OTHER"],
  ] as const)("category of %s %s → %s", (sheet, alarmName, category) => {
    expect(hourlyCategory({ sheet, alarmName })).toBe(category);
  });
});

describe("normalization (FR-56)", () => {
  it("base: collapse spaces, trim, upper-case", () => {
    expect(baseNormalize("  rectifier   minor\talarm ")).toBe("RECTIFIER MINOR ALARM");
  });

  it("normalizes exactly the eight filter fields", () => {
    expect(NORMALIZED_FIELDS).toEqual([
      "alarmName",
      "alarmText",
      "supplementaryInfo",
      "siteName",
      "office",
      "siteType",
      "nodality",
      "powerSource",
    ]);
  });

  const r = sample((x) => x.sheet === "Environmental" && x.alarmName === "RECTIFIER MINOR ALARM");

  it("with no rules applies only the base normalization", () => {
    const n = compileNormalizer([]);
    expect(n({ ...r, alarmName: " rectifier  minor alarm", dn: "keep  as is" })).toMatchObject({
      alarmName: "RECTIFIER MINOR ALARM",
      dn: "keep  as is",
    });
  });

  it("replaces whole tokens only, longest rule first", () => {
    const n = compileNormalizer([
      { field: "alarmName", from: "MINOR", to: "MIN" },
      { field: "alarmName", from: "RECTIFIER MINOR", to: "RECT-MINOR" },
      { field: "alarmName", from: "ALARM", to: "ALM" },
    ]);
    expect(n({ ...r, alarmName: "RECTIFIER MINOR ALARM" }).alarmName).toBe("RECT-MINOR ALM");
    expect(n({ ...r, alarmName: "MINORITY ALARMS" }).alarmName).toBe("MINORITY ALARMS");
  });

  it("applies alarmName rules to Alarm Text and Supplementary Information too", () => {
    const n = compileNormalizer([{ field: "alarmName", from: "BASE STATION", to: "BTS" }]);
    const out = n({ ...r, alarmName: "X", alarmText: "BASE STATION EXTERNAL ALARM NOTIFICATION", supplementaryInfo: "base station down" });
    expect(out.alarmText).toBe("BTS EXTERNAL ALARM NOTIFICATION");
    expect(out.supplementaryInfo).toBe("BTS DOWN");
  });

  it("applies `*` rules to every normalized field and field rules to that field only", () => {
    const n = compileNormalizer([
      { field: "*", from: "KAFR EL DAWAR", to: "KFDW" },
      { field: "office", from: "TANTA", to: "TNT" },
    ]);
    const out = n({ ...r, office: "kafr el dawar", siteName: "TANTA KAFR EL DAWAR", siteType: "TANTA" });
    expect(out.office).toBe("KFDW");
    expect(out.siteName).toBe("TANTA KFDW");
    expect(out.siteType).toBe("TANTA");
  });

  it("leaves null fields null", () => {
    expect(compileNormalizer([])({ ...r, office: null }).office).toBeNull();
  });
});

describe("diffHourly (FR-61)", () => {
  it("keys rows by code|alarmName|dn", () => {
    const x = rows[0]!;
    expect(hourlyDiffKey(x)).toBe(`${x.siteCode}|${x.alarmName}|${x.dn}`);
  });

  it("finds nothing between a report and itself", () => {
    expect(diffHourly(rows, rows)).toEqual({ new: [], disappeared: [] });
  });

  it("finds rows only in the current report as new, and rows only in the previous one as disappeared", () => {
    const previous = rows.filter((r) => r.sheet !== "HW");
    const current = rows.filter((r) => r.sheet !== "Environmental");
    const d = diffHourly(previous, current);
    const keys = (list: HourlyRow[]) => new Set(list.map(hourlyDiffKey));
    const prevKeys = keys(previous);
    const curKeys = keys(current);
    expect(new Set(d.new.map(hourlyDiffKey))).toEqual(new Set([...curKeys].filter((k) => !prevKeys.has(k))));
    expect(new Set(d.disappeared.map(hourlyDiffKey))).toEqual(new Set([...prevKeys].filter((k) => !curKeys.has(k))));
    expect(d.new.every((r) => r.sheet === "HW")).toBe(true);
  });

  it("ignores the alarm time", () => {
    const shifted = rows.map((r) => ({ ...r, alarmTime: "2030-01-01 00:00:00" }));
    expect(diffHourly(rows, shifted)).toEqual({ new: [], disappeared: [] });
  });
});
