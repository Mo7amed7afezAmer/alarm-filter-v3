import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  filterHourlyRows,
  hourlyFacets,
  type HourlyFilter,
  type HourlyRow,
  type NormalizationRule,
  type SiteMasterRecord,
} from "@alarm/core";
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

import { FILTER_FACETS, HourlyReports, processXlsxOnDevice, reportFacets, reportPath, sheetTabs, toggleValue, visibleRows } from "./hourly";

const samples = fileURLToPath(new URL("../../../samples/hourly/", import.meta.url));
const xlsx = new Uint8Array(readFileSync(samples + "nsn-update-output.xlsx"));
const siteMaster = JSON.parse(readFileSync(samples + "site-master.json", "utf8")) as SiteMasterRecord[];
const reference = JSON.parse(readFileSync(samples + "reference-output.json", "utf8")) as { stats: unknown; rows: HourlyRow[] };
const ref = { updatedAt: "2026-10-17T00:00:00.000Z", siteMaster, normalizations: [] as NormalizationRule[] };

// P7-T04: hourly reports on the phone: the server's …/xlsx (D-11) parsed on the device with
// SheetJS + packages/core, chunked so the UI frame is not blocked.
describe("hourly reports on the phone (P7-T04)", () => {
  it("gives the same rows as the web: samples/hourly/reference-output.json, field by field", async () => {
    const { rows, stats } = await processXlsxOnDevice(xlsx, ref, async () => undefined);
    expect(rows).toHaveLength(reference.rows.length);
    for (let i = 0; i < rows.length; i++) expect(rows[i], `row ${i}`).toEqual(reference.rows[i]);
    expect(stats).toEqual(reference.stats);
  });

  it("yields to the UI between the steps (one per hourly sheet at least)", async () => {
    const pause = vi.fn(async () => undefined);
    await processXlsxOnDevice(xlsx, ref, pause);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("lists reports from /hourly-reports with the Gmail page token", () => {
    expect(reportPath()).toBe("/api/v1/hourly-reports");
    expect(reportPath("tok 1")).toBe("/api/v1/hourly-reports?pageToken=tok+1");
  });

  it("sheet tabs show the six hourly sheets with their row counts", async () => {
    const { rows } = await processXlsxOnDevice(xlsx, ref, async () => undefined);
    const tabs = sheetTabs(rows);
    expect(tabs.map((t) => t.sheet)).toEqual(["2G_Down", "3G_Down", "4G_Down", "5G_Down", "Environmental", "HW"]);
    expect(tabs.reduce((n, t) => n + t.count, 0)).toBe(rows.length);
  });

  it("opens a report with one …/xlsx download and one reference request; filters and tabs need no network", async () => {
    const get = vi.fn(async (path: string) => {
      expect(path).toBe("/api/v1/hourly-reference");
      return ref;
    });
    const request = vi.fn(async (path: string) => {
      expect(path).toBe("/api/v1/hourly-reports/msg123/xlsx");
      return new Response(xlsx);
    });
    const reports = new HourlyReports({ get, request } as never, async () => undefined);
    const report = await reports.open("msg123");
    expect(request).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);

    const env = reports.filter(report, { sheet: ["Environmental"] });
    const power = reports.filter(report, { category: ["POWER"] });
    expect(env.every((r) => r.sheet === "Environmental")).toBe(true);
    expect(power.every((r) => r.category === "POWER")).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps opened reports in memory (3 at most, like the web) and clear() drops them", async () => {
    const request = vi.fn(async () => new Response(xlsx));
    const reports = new HourlyReports({ get: vi.fn(async () => ref), request } as never, async () => undefined);
    await reports.open("a");
    await reports.open("a");
    expect(request).toHaveBeenCalledTimes(1);
    for (const id of ["b", "c", "d"]) await reports.open(id);
    expect(reports.size).toBe(3);
    reports.clear();
    expect(reports.size).toBe(0);
  });

  it("offers the web's filters (FR-59): office, region, category, site type, alarm facets of the open tab", () => {
    expect(FILTER_FACETS.map((f) => f.key)).toEqual(["office", "region", "category", "siteType", "alarm"]);
    const env = reference.rows.filter((r) => r.sheet === "Environmental");
    const facets = reportFacets(reference.rows, "Environmental");
    expect(facets).toEqual(hourlyFacets(env, ["office", "region", "category", "siteType", "alarmName"]));
    expect(reportFacets(reference.rows, null).office).toEqual(hourlyFacets(reference.rows, ["office"]).office);
  });

  it("toggles multi-select values and drops empty lists", () => {
    let f: HourlyFilter = {};
    f = toggleValue(f, "office", "CAIRO");
    f = toggleValue(f, "office", "GIZA");
    expect(f.office).toEqual(["CAIRO", "GIZA"]);
    f = toggleValue(f, "office", "CAIRO");
    expect(f.office).toEqual(["GIZA"]);
    f = toggleValue(f, "office", "GIZA");
    expect(f).toEqual({});
  });

  it("filtered rows equal the web's for every filter (tab + sheet, region, office, alarm, siteType, category, vip, from, to, q)", async () => {
    const report = await processXlsxOnDevice(xlsx, ref, async () => undefined);
    // The sample has no site types: that case checks that both sides return nothing.
    const top = (field: "office" | "region" | "alarmName" | "siteType") =>
      hourlyFacets(reference.rows, [field])[field]![0]?.value ?? "NONE";
    const times = reference.rows.map((r) => r.alarmTime).sort();
    const cases: [string | null, HourlyFilter][] = [
      [null, {}],
      ["Environmental", {}],
      [null, { region: [top("region")] }],
      [null, { office: [top("office")] }],
      [null, { alarm: [top("alarmName")] }],
      [null, { siteType: [top("siteType")] }],
      ["Environmental", { category: ["POWER"] }],
      [null, { vip: true }],
      [null, { vip: false }],
      [null, { from: times[Math.floor(times.length / 2)] }],
      [null, { to: times[Math.floor(times.length / 2)] }],
      [null, { q: "site" }],
      ["2G_Down", { office: [top("office")], vip: false, q: "a" }],
    ];
    for (const [tab, f] of cases) {
      const web = filterHourlyRows(
        reference.rows.filter((r) => !tab || r.sheet === tab),
        f,
      );
      expect(visibleRows(report.rows, tab, f), JSON.stringify([tab, f])).toEqual(web);
    }
  });

  it("processes a 40k-row report (the G-T14 timing input) in steps, under 20 s in Node", async () => {
    const wb = XLSX.read(xlsx);
    const out = XLSX.utils.book_new();
    for (const name of wb.SheetNames) {
      if (name === "All") continue;
      const [head, ...body] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: "" });
      const big: unknown[][] = [head ?? []];
      for (let t = 0; t < 16; t++) for (const r of body) big.push(r.map((c, i) => (i === 4 ? `${String(c)}/COPY-${t}` : c)));
      XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(big), name);
    }
    const input = Object.values(out.Sheets).reduce((n, ws) => n + XLSX.utils.decode_range(ws["!ref"]!).e.r, 0);
    expect(input).toBeGreaterThanOrEqual(40_000);
    const bytes = new Uint8Array(XLSX.write(out, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const pause = vi.fn(async () => undefined);
    const started = Date.now();
    const { rows } = await processXlsxOnDevice(bytes, ref, pause);
    const ms = Date.now() - started;
    expect(rows.length).toBeGreaterThan(30_000);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(ms).toBeLessThan(20_000);
  });
});
