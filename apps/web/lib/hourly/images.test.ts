import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HourlyRow } from "@alarm/core";
import { describe, expect, it } from "vitest";
import { COMPACT_COLUMNS, DEFAULT_ROWS_PER_IMAGE, imagePages, ROWS_PER_IMAGE } from "./images";

const rows = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../../samples/hourly/reference-output.json", import.meta.url)), "utf8")) as {
    rows: HourlyRow[];
  }
).rows;

// FR-63: image pages.
describe("imagePages", () => {
  it("offers 25/40/60/100 rows per image, default 40, and compact columns", () => {
    expect(ROWS_PER_IMAGE).toEqual([25, 40, 60, 100]);
    expect(DEFAULT_ROWS_PER_IMAGE).toBe(40);
    expect(COMPACT_COLUMNS.length).toBeGreaterThan(0);
  });

  it("makes separate image sets per category by default", () => {
    const pages = imagePages(rows, 40, true);
    for (const c of ["DOWN", "POWER", "OTHER"] as const) {
      const n = rows.filter((r) => r.category === c).length;
      const mine = pages.filter((p) => p.label === c);
      expect(mine).toHaveLength(Math.ceil(n / 40));
      expect(mine.flatMap((p) => p.rows)).toHaveLength(n);
      expect(mine.every((p) => p.rows.every((r) => r.category === c) && p.rows.length <= 40)).toBe(true);
    }
  });

  it("can put every category in one set", () => {
    const pages = imagePages(rows, 100, false);
    expect(pages).toHaveLength(Math.ceil(rows.length / 100));
    expect(pages.every((p) => p.label === "ALL")).toBe(true);
  });

  it("still makes one (empty) image for no rows", () => {
    expect(imagePages([], 40, false)).toHaveLength(1);
  });
});
