import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY_PREFS, matchesPrefs, normalizePrefs } from "./index";

// FR-45: prefs = enabled, sound, categories, exact alarm names, site substrings;
// OR within a filter, AND across filters; default DOWN only.
const alarm = { category: "DOWN" as const, alarmName: "S_D_N_BTS O&M LINK FAILURE", site: "3531_S_KS-SHARAQA_3961DE" };

describe("DEFAULT_NOTIFY_PREFS", () => {
  it("notifies DOWN alarms only", () => {
    expect(DEFAULT_NOTIFY_PREFS.categories).toEqual(["DOWN"]);
    expect(DEFAULT_NOTIFY_PREFS.alarmNames).toEqual([]);
    expect(DEFAULT_NOTIFY_PREFS.sites).toEqual([]);
    expect(DEFAULT_NOTIFY_PREFS.enabled).toBe(true);
    expect(matchesPrefs(alarm, DEFAULT_NOTIFY_PREFS)).toBe(true);
    expect(matchesPrefs({ ...alarm, category: "POWER" }, DEFAULT_NOTIFY_PREFS)).toBe(false);
  });
});

describe("normalizePrefs", () => {
  it("returns the defaults for missing or malformed input", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(normalizePrefs("x")).toEqual(DEFAULT_NOTIFY_PREFS);
  });

  it("keeps valid fields, drops invalid entries and duplicates", () => {
    expect(
      normalizePrefs({
        enabled: false,
        sound: true,
        categories: ["POWER", "POWER", "NOPE"],
        alarmNames: ["A", "", "A", 1],
        sites: [" 3961DE ", "3961DE"],
      }),
    ).toEqual({ enabled: false, sound: true, categories: ["POWER"], alarmNames: ["A"], sites: ["3961DE"] });
  });

  it("fills missing fields from the defaults", () => {
    expect(normalizePrefs({ sound: true })).toEqual({ ...DEFAULT_NOTIFY_PREFS, sound: true });
  });
});

describe("matchesPrefs", () => {
  const prefs = (over: Partial<typeof DEFAULT_NOTIFY_PREFS>) => ({ ...DEFAULT_NOTIFY_PREFS, categories: [], ...over });

  it("matches nothing when disabled", () => {
    expect(matchesPrefs(alarm, prefs({ enabled: false }))).toBe(false);
  });

  it("matches everything when every filter is empty", () => {
    expect(matchesPrefs(alarm, prefs({}))).toBe(true);
  });

  it("is OR within a filter", () => {
    expect(matchesPrefs(alarm, prefs({ categories: ["POWER", "DOWN"] }))).toBe(true);
    expect(matchesPrefs(alarm, prefs({ alarmNames: ["X", alarm.alarmName] }))).toBe(true);
    expect(matchesPrefs(alarm, prefs({ sites: ["NOPE", "SHARAQA"] }))).toBe(true);
  });

  it("is AND across filters", () => {
    expect(matchesPrefs(alarm, prefs({ categories: ["DOWN"], sites: ["SHARAQA"] }))).toBe(true);
    expect(matchesPrefs(alarm, prefs({ categories: ["DOWN"], sites: ["ZAGAZIG"] }))).toBe(false);
  });

  it("matches alarm names exactly and sites as substrings", () => {
    expect(matchesPrefs(alarm, prefs({ alarmNames: ["S_D_N_BTS O&M LINK"] }))).toBe(false);
    expect(matchesPrefs(alarm, prefs({ sites: ["3961"] }))).toBe(true);
  });
});
