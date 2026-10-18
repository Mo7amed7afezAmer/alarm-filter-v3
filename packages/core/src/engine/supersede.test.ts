import { SEED_RULES } from "@alarm/db";
import { describe, expect, it } from "vitest";
import { MemoryStore, processBatch, type NewRawMessage } from "./index";

// FR-20: an older alarm arriving after a newer one of the same key is already ACTIVE.
// Built inline, modelled on samples/engine/e17-aa (samples/ is never written).
const opts = { rules: SEED_RULES };
const name = "D_S_BCCH MISSING";
const site = "2421_O_MF-HK-FRAWNYH_0G01DE";
const key = `${name}||${site}`;
const subjectAt = (t: string) => `${name} on #${site}# at |11-OCT-2026 ${t} |`;
// Africa/Cairo is UTC+3 on 11-OCT-2026.
const T1 = "2026-10-11T13:40:00.000Z"; // 16:40:00 local
const T2 = "2026-10-11T13:52:00.000Z"; // 16:52:00 local

const consecBody = (consec: string) =>
  ["ALARM_SITE:", `\t\t${site}`, "ALARM_Device:", "\t\tBTS", "CONSEC_NBR: ", `\t\t ${consec}`, ""].join("\n");

const msg = (gmailId: string, time: string, receivedAt: string, body: string | null = null): NewRawMessage => ({
  gmailId,
  subject: subjectAt(time),
  receivedAt: new Date(receivedAt),
  body,
  office: "DN",
});

async function runBatches(batches: NewRawMessage[][]) {
  const store = new MemoryStore();
  const outcomes = [];
  for (const batch of batches) {
    await store.insertRawMessages(batch);
    outcomes.push(await processBatch(store, opts));
  }
  return { store, outcomes };
}

const byTime = (store: MemoryStore, iso: string) => store.alarms.find((a) => a.alarmTime.toISOString() === iso)!;

describe("late older alarm (FR-20)", () => {
  it("FR-20: body-less older alarm arriving after a newer ACTIVE one is created already CLEARED/AUTO_SUPERSEDED", async () => {
    const { store, outcomes } = await runBatches([
      [msg("n1", "16:52:00", "2026-10-11T13:52:30.000Z")],
      [msg("o1", "16:40:00", "2026-10-11T13:55:00.000Z")],
    ]);

    expect(outcomes[0]).toMatchObject({ created: 1, created_superseded: 0 });
    expect(outcomes[1]).toMatchObject({ created: 0, created_superseded: 1 });
    expect(store.alarms).toHaveLength(2);

    const older = byTime(store, T1);
    expect(older).toMatchObject({
      alarmKey: key,
      status: "CLEARED",
      clearType: "AUTO_SUPERSEDED",
      consecNbr: null,
    });
    // Closed at the newer alarm's time (same rule as the in-order supersede); FR-21 duration.
    expect(older.clearTime?.toISOString()).toBe(T2);
    expect(older.durationMin).toBe(12);

    const newer = byTime(store, T2);
    expect(newer).toMatchObject({ alarmKey: key, status: "ACTIVE", clearType: null, clearTime: null, durationMin: null });
  });

  it("FR-20: with consecNbr on both, the late older alarm is created ACTIVE (never superseded)", async () => {
    const { store, outcomes } = await runBatches([
      [msg("n1", "16:52:00", "2026-10-11T13:52:30.000Z", consecBody("200"))],
      [msg("o1", "16:40:00", "2026-10-11T13:55:00.000Z", consecBody("100"))],
    ]);

    expect(outcomes[1]).toMatchObject({ created: 1, created_superseded: 0 });
    expect(store.alarms).toHaveLength(2);
    expect(byTime(store, T1)).toMatchObject({ consecNbr: "100", status: "ACTIVE", clearType: null, clearTime: null });
    expect(byTime(store, T2)).toMatchObject({ consecNbr: "200", status: "ACTIVE", clearType: null, clearTime: null });
  });
});

describe("non-numeric CONSEC_NBR is not used (FR-12)", () => {
  it("FR-12: an alarm whose CONSEC_NBR is non-numeric is stored with consecNbr, cellName, device null", async () => {
    const body = ["cell name :", "\t\tC1", "ALARM_Device:", "\t\tcell", "CONSEC_NBR: ", "\t\t N/A", ""].join("\n");
    const { store } = await runBatches([[msg("a1", "16:40:00", "2026-10-11T13:41:00.000Z", body)]]);
    expect(store.alarms).toHaveLength(1);
    expect(store.alarms[0]).toMatchObject({ alarmKey: key, consecNbr: null, cellName: null, device: null, status: "ACTIVE" });
  });
});
