import { describe, expect, it } from "vitest";
import { parseDateParam } from "./date-param";

// NFR-29 / G-T10: `YYYY-MM-DD` means local midnight in ALARM_TZ (Africa/Cairo).
describe("parseDateParam", () => {
  it("reads 2026-10-14 as local midnight: 2026-10-13T21:00:00Z (summer time, UTC+3)", () => {
    expect(parseDateParam("2026-10-14", "Africa/Cairo")?.toISOString()).toBe("2026-10-13T21:00:00.000Z");
  });

  it("follows the winter offset (UTC+2)", () => {
    expect(parseDateParam("2026-12-01", "Africa/Cairo")?.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });

  it("accepts a full ISO timestamp unchanged", () => {
    expect(parseDateParam("2026-10-11T13:20:00.000Z", "Africa/Cairo")?.toISOString()).toBe("2026-10-11T13:20:00.000Z");
    expect(parseDateParam("2026-10-11T16:20:00+03:00", "Africa/Cairo")?.toISOString()).toBe("2026-10-11T13:20:00.000Z");
  });

  it.each(["2026-02-30", "2026-13-01", "yesterday", "2026-10-1", ""])("rejects %j", (value) => {
    expect(parseDateParam(value, "Africa/Cairo")).toBeNull();
  });
});
