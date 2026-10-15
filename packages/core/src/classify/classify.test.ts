import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_RULES } from "@alarm/db";
import { describe, expect, it } from "vitest";
import { classify, type ClassifyRule } from "./index";

const casesDir = fileURLToPath(new URL("../../../../samples/parser", import.meta.url));
const sampleNames = [
  ...new Set(
    readdirSync(casesDir)
      .map((d) => JSON.parse(readFileSync(join(casesDir, d, "expected.json"), "utf8")) as { alarmName?: string })
      .filter((e) => e.alarmName)
      .map((e) => e.alarmName!),
  ),
].sort();

describe("classify (FR-15) with the seed rules (FR-16)", () => {
  it.each(SEED_RULES)("matches seed rule $pattern → $category", (rule) => {
    // The pattern alone, embedded and in lower case: a case-insensitive substring match.
    expect(classify(rule.pattern, SEED_RULES)).toBe(rule.category);
    expect(classify(`S_D_N_${rule.pattern.toLowerCase()} alarm`, SEED_RULES)).toBe(rule.category);
  });

  // Real alarm names from samples/parser, classified by the first matching seed rule.
  const realExpected: Record<string, "DOWN" | "POWER" | "OTHER"> = {
    "D_S_BCCH MISSING": "OTHER",
    "D_S_BTS O&M LINK FAILURE": "DOWN",
    "D_S_WCDMA CELL OUT OF USE": "OTHER",
    "S_D_N_BCCH MISSING": "OTHER",
    "S_D_N_BTS O&M LINK FAILURE": "DOWN",
    "S_D_N_FENCE GATE ALARM": "OTHER",
    "S_D_N_FIRE ALARM": "OTHER",
    "S_D_N_MAIN POWER CUT OFF": "POWER",
    "S_D_N_NE3S-WS Registration failed": "OTHER",
    "S_D_N_NE3SWS AGENT NOT RESPONDING TO REQUESTS": "OTHER",
    "S_D_N_RECTIFIER MAJOR ALARM": "POWER",
    "S_D_N_RECTIFIER MINOR ALARM": "POWER",
    "S_D_N_SHELTER DOO": "OTHER",
    "S_D_N_SHELTER DOOR ALARM": "OTHER",
    "S_D_N_SHELTER HIGH TEMPRATURE": "OTHER",
    "S_D_N_WCDMA BASE STATION OUT OF USE": "OTHER",
    "S_D_N_WCDMA CELL OUT OF USE": "OTHER",
  };

  it("covers every alarm name in samples/parser", () => {
    expect(Object.keys(realExpected).sort()).toEqual(sampleNames);
  });

  it.each(Object.entries(realExpected))("%s → %s", (name, category) => {
    expect(classify(name, SEED_RULES)).toBe(category);
  });

  it("returns OTHER when no rule matches", () => {
    expect(classify("S_D_N_FIRE ALARM", SEED_RULES)).toBe("OTHER");
  });

  it("returns OTHER when there are no rules", () => {
    expect(classify("LINK FAILURE", [])).toBe("OTHER");
  });

  it("uses the first matching rule by ascending priority, whatever the input order", () => {
    const rules: ClassifyRule[] = [
      { pattern: "POWER", category: "POWER", priority: 130 },
      { pattern: "NODE DOWN", category: "DOWN", priority: 60 },
    ];
    expect(classify("POWER NODE DOWN", rules)).toBe("DOWN");
    expect(classify("POWER NODE DOWN", [...rules].reverse())).toBe("DOWN");
  });
});
