import { describe, expect, it } from "vitest";
import { effectiveDisplayFilter, isHidden, normalizeDisplayFilter } from "./index";

// FR-41 (admin hides categories and exact alarm names for everyone) and
// FR-42 (each user hides more for themselves; merged; a user cannot un-hide).

describe("normalizeDisplayFilter", () => {
  it("keeps valid categories and non-empty names, without duplicates", () => {
    expect(
      normalizeDisplayFilter({
        categories: ["OTHER", "OTHER", "NOPE", 3],
        alarmNames: ["S_D_N_FIRE ALARM", "", "S_D_N_FIRE ALARM", null],
      }),
    ).toEqual({ categories: ["OTHER"], alarmNames: ["S_D_N_FIRE ALARM"] });
  });

  it("returns an empty filter for missing or malformed input", () => {
    expect(normalizeDisplayFilter(null)).toEqual({ categories: [], alarmNames: [] });
    expect(normalizeDisplayFilter("x")).toEqual({ categories: [], alarmNames: [] });
  });
});

describe("isHidden", () => {
  const filter = { categories: ["OTHER" as const], alarmNames: ["S_D_N_RECTIFIER MINOR ALARM"] };

  it("hides an alarm whose category is hidden", () => {
    expect(isHidden({ category: "OTHER", alarmName: "S_D_N_FIRE ALARM" }, filter)).toBe(true);
  });

  it("hides an alarm whose name is hidden exactly", () => {
    expect(isHidden({ category: "POWER", alarmName: "S_D_N_RECTIFIER MINOR ALARM" }, filter)).toBe(true);
  });

  it("does not hide on a partial or different-case name", () => {
    expect(isHidden({ category: "POWER", alarmName: "S_D_N_RECTIFIER MINOR" }, filter)).toBe(false);
    expect(isHidden({ category: "POWER", alarmName: "s_d_n_rectifier minor alarm" }, filter)).toBe(false);
  });

  it("shows everything else", () => {
    expect(isHidden({ category: "DOWN", alarmName: "S_D_N_BTS O&M LINK FAILURE" }, filter)).toBe(false);
  });
});

describe("effectiveDisplayFilter", () => {
  it("merges the admin and user filters", () => {
    const admin = { categories: ["OTHER" as const], alarmNames: ["A"] };
    const user = { categories: ["POWER" as const], alarmNames: ["B"] };
    expect(effectiveDisplayFilter(admin, user)).toEqual({ categories: ["OTHER", "POWER"], alarmNames: ["A", "B"] });
  });

  it("never un-hides what the admin hid", () => {
    const admin = { categories: ["OTHER" as const], alarmNames: ["A"] };
    const merged = effectiveDisplayFilter(admin, { categories: [], alarmNames: [] });
    expect(isHidden({ category: "OTHER", alarmName: "X" }, merged)).toBe(true);
    expect(isHidden({ category: "DOWN", alarmName: "A" }, merged)).toBe(true);
  });
});
