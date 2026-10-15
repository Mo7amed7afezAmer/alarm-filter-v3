import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config";

const base = { GOOGLE_CREDENTIALS_PATH: "c.json", GOOGLE_TOKEN_PATH: "t.json" };

describe("loadWorkerConfig (§6, NFR-34)", () => {
  it("applies the defaults", () => {
    expect(loadWorkerConfig(base)).toMatchObject({
      cron: "* * * * *",
      healthPort: 4000,
      healthStaleAfterSec: 300,
      gmailLabels: [],
      officeLabelParents: ["DN", "DS"],
      alarmTz: "Africa/Cairo",
    });
  });

  it("reads overrides; GMAIL_LABELS and OFFICE_LABEL_PARENTS are comma lists", () => {
    expect(
      loadWorkerConfig({
        ...base,
        WORKER_CRON: "*/5 * * * *",
        WORKER_HEALTH_PORT: "4100",
        HEALTH_STALE_AFTER_SEC: "600",
        GMAIL_LABELS: "DN/Kafr ElDawar, DS/Zagazig",
        OFFICE_LABEL_PARENTS: "DN",
        ALARM_TZ: "UTC",
      }),
    ).toMatchObject({
      cron: "*/5 * * * *",
      healthPort: 4100,
      healthStaleAfterSec: 600,
      gmailLabels: ["DN/Kafr ElDawar", "DS/Zagazig"],
      officeLabelParents: ["DN"],
      alarmTz: "UTC",
    });
  });

  it("rejects an invalid WORKER_CRON", () => {
    expect(() => loadWorkerConfig({ ...base, WORKER_CRON: "every minute" })).toThrow("WORKER_CRON");
  });

  it.each(["WORKER_HEALTH_PORT", "HEALTH_STALE_AFTER_SEC", "MAX_MESSAGES_PER_RUN"])("rejects a non-integer %s", (name) => {
    expect(() => loadWorkerConfig({ ...base, [name]: "x" })).toThrow(name);
  });
});
