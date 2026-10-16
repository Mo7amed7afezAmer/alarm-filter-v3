import { describe, expect, it } from "vitest";
import { AGE_TICK_MS, ALARMS_REFRESH_MS, ageText, alertHoursFrom, isAlert, telHref } from "./alarm-ui";

describe("alarm page helpers", () => {
  it("re-renders ages every 30 s and refreshes the lists every 60 s (FR-33, NFR-06)", () => {
    expect(AGE_TICK_MS).toBe(30_000);
    expect(ALARMS_REFRESH_MS).toBe(60_000);
  });

  it("highlights alarms older than ALERT_HOURS (FR-33)", () => {
    const now = new Date("2026-10-11T19:00:00Z");
    expect(isAlert(new Date("2026-10-11T14:59:59Z"), now, 4)).toBe(true);
    expect(isAlert(new Date("2026-10-11T15:00:00Z"), now, 4)).toBe(false);
  });

  it("reads ALERT_HOURS with a default of 4", () => {
    expect(alertHoursFrom(undefined)).toBe(4);
    expect(alertHoursFrom("6")).toBe(6);
    expect(alertHoursFrom("x")).toBe(4);
  });

  it("formats an age as hours and minutes", () => {
    const now = new Date("2026-10-11T19:00:00Z");
    expect(ageText(new Date("2026-10-11T18:55:00Z"), now)).toBe("5m");
    expect(ageText(new Date("2026-10-11T13:30:00Z"), now)).toBe("5h 30m");
    expect(ageText(new Date("2026-10-09T18:00:00Z"), now)).toBe("2d 1h");
  });

  it("makes tel: links from phone text, keeping several numbers apart (FR-34)", () => {
    expect(telHref("01000000001")).toBe("tel:01000000001");
    expect(telHref("010 000 / 011 222")).toBe("tel:010000");
  });
});
