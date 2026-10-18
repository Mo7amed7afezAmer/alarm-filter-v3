import { describe, expect, it } from "vitest";
import { filterHourlyRows, hourlyFacets, pageOf, ReportCache, sortHourlyRows, type HourlyRow } from "./index";
import { reference } from "./test-helpers";

const rows = reference.rows;
const count = (pred: (r: HourlyRow) => boolean) => rows.filter(pred).length;

// FR-59: filters, sort, paging and facets — now computed in the browser (D-10).
describe("filterHourlyRows (FR-59)", () => {
  it("returns every row without filters", () => {
    expect(filterHourlyRows(rows, {})).toHaveLength(rows.length);
  });

  it.each([
    ["sheet", { sheet: ["Environmental"] }, (r: HourlyRow) => r.sheet === "Environmental"],
    ["several sheets (OR)", { sheet: ["HW", "2G_Down"] }, (r: HourlyRow) => r.sheet === "HW" || r.sheet === "2G_Down"],
    ["region", { region: ["AL"] }, (r: HourlyRow) => r.region === "AL"],
    ["office", { office: ["KAFR EL DAWAR"] }, (r: HourlyRow) => r.office === "KAFR EL DAWAR"],
    ["alarm name", { alarm: ["BCCH MISSING"] }, (r: HourlyRow) => r.alarmName === "BCCH MISSING"],
    ["category", { category: ["POWER" as const] }, (r: HourlyRow) => r.category === "POWER"],
    ["vip", { vip: true }, (r: HourlyRow) => r.vip === true],
    [
      "sheet AND category",
      { sheet: ["Environmental"], category: ["OTHER" as const] },
      (r: HourlyRow) => r.sheet === "Environmental" && r.category === "OTHER",
    ],
  ])("%s", (_name, filter, pred) => {
    const out = filterHourlyRows(rows, filter);
    expect(out).toHaveLength(count(pred));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(pred)).toBe(true);
  });

  it("siteType filter", () => {
    const withType = rows.map((r, i) => ({ ...r, siteType: i % 2 ? "ROOFTOP" : null }));
    expect(filterHourlyRows(withType, { siteType: ["ROOFTOP"] })).toHaveLength(withType.filter((r) => r.siteType === "ROOFTOP").length);
  });

  it("from / to compare the wall-clock alarm time, inclusive", () => {
    const from = "2026-10-13 06:00:00";
    const to = "2026-10-13 07:00:00";
    const out = filterHourlyRows(rows, { from, to });
    expect(out).toHaveLength(count((r) => r.alarmTime >= from && r.alarmTime <= to));
    expect(out.length).toBeGreaterThan(0);
  });

  it("q searches alarm name, site, code, DN and office, case-insensitive", () => {
    const out = filterHourlyRows(rows, { q: "sidi-ghazy" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => `${r.siteName} ${r.dn}`.toUpperCase().includes("SIDI-GHAZY"))).toBe(true);
    expect(filterHourlyRows(rows, { q: "0444de" })).toHaveLength(count((r) => r.siteCode === "0444DE" || r.siteName.includes("0444DE")));
  });
});

describe("sortHourlyRows", () => {
  it("sorts by a column, ascending or descending, with nulls last", () => {
    const asc = sortHourlyRows(rows, "alarmTime", "asc");
    for (let i = 1; i < asc.length; i++) expect(asc[i - 1]!.alarmTime <= asc[i]!.alarmTime).toBe(true);
    const desc = sortHourlyRows(rows, "office", "desc");
    const firstNull = desc.findIndex((r) => r.office === null);
    expect(desc.slice(firstNull).every((r) => r.office === null)).toBe(true);
  });

  it("does not change the input", () => {
    const copy = [...rows];
    sortHourlyRows(rows, "siteCode", "desc");
    expect(rows).toEqual(copy);
  });
});

describe("pageOf", () => {
  it("returns one page of at most `limit` rows (1–500)", () => {
    expect(pageOf(rows, 1, 500).items).toHaveLength(500);
    expect(pageOf(rows, 5, 500).items).toHaveLength(rows.length - 2000);
    expect(pageOf(rows, 1, 9999).limit).toBe(500);
    expect(pageOf(rows, 0, 0)).toMatchObject({ page: 1, limit: 1 });
  });
});

describe("hourlyFacets", () => {
  it("counts each value, most frequent first", () => {
    const f = hourlyFacets(rows, ["sheet", "category"]);
    expect(f.sheet!.reduce((s, x) => s + x.count, 0)).toBe(rows.length);
    expect(f.category).toEqual(
      Object.entries(reference.stats.byCategory)
        .map(([value, n]) => ({ value, count: n }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    );
  });
});

// PLAN G-T14: at most 3 processed reports in memory, least recently used evicted first.
describe("ReportCache (3-report cap)", () => {
  it("holds 3 reports and evicts the least recently used", () => {
    const c = new ReportCache<string>();
    c.set("a", "A");
    c.set("b", "B");
    c.set("c", "C");
    expect(c.get("a")).toBe("A"); // a is now the most recent
    c.set("d", "D");
    expect(c.keys()).toEqual(["c", "a", "d"]);
    expect(c.get("b")).toBeUndefined();
  });

  it("replacing a report does not evict another", () => {
    const c = new ReportCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("a", 4);
    expect(c.keys()).toEqual(["b", "c", "a"]);
    expect(c.get("a")).toBe(4);
  });

  it("clear() drops everything (logout)", () => {
    const c = new ReportCache<number>(3);
    c.set("a", 1);
    c.clear();
    expect(c.keys()).toEqual([]);
    expect(c.size).toBe(0);
  });

  it("delete() drops one report", () => {
    const c = new ReportCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a");
    expect(c.keys()).toEqual(["b"]);
  });
});
