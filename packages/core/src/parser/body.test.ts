import { describe, expect, it } from "vitest";
import { isNumericConsec, parseBody, parseMessage } from "./index";

// FR-11 / FR-12: built inline, modelled on samples/parser/b01-body-cell-new (samples/ is never written).
const subject = "S_D_N_WCDMA CELL OUT OF USE on #U_S_BH-MHLT-KYL_3830DE# at |11-OCT-2026 21:36:45 |";
const keyNoCell = "S_D_N_WCDMA CELL OUT OF USE||U_S_BH-MHLT-KYL_3830DE";
const cell = "A_BH-MHLT-KYL_4_24314_S";

/** `consec === undefined` drops the CONSEC_NBR label entirely. */
function body(consec: string | undefined): string {
  return [
    "\t\t\t\t############NEW ALARM###########",
    "",
    "ALARM NAME: ",
    "\t\tWCDMA CELL OUT OF USE",
    "ALARM_START_TIME: ",
    "\t\t11-OCT-2026 21:36:45",
    "NE_name: ",
    "\t\tRNC66",
    "Alarm_Number",
    "\t\t7771",
    "MR_of_Controled_NE: ",
    "\t\tNO",
    "MR_of_Site:",
    "\t\tSYS_DELTA_NORTH",
    "ALARM_SITE:",
    "\t\tU_S_BH-MHLT-KYL_3830DE",
    "cell name :",
    `\t\t${cell}`,
    "ALARM_Device:",
    "\t\tcell",
    ...(consec === undefined ? [] : ["CONSEC_NBR: ", `\t\t ${consec}`]),
    "",
    "THANKS FOR USING THIS TOOL",
    "",
    "REGARGDS",
    "D.S",
    "",
  ].join("\n");
}

describe("parseBody labels (FR-12)", () => {
  it("FR-12: parses every body label, value on the next line", () => {
    expect(parseBody(body("2294476"))).toEqual({
      alarmName: "WCDMA CELL OUT OF USE",
      startTime: "11-OCT-2026 21:36:45",
      neName: "RNC66",
      alarmNumber: "7771",
      site: "U_S_BH-MHLT-KYL_3830DE",
      cellName: cell,
      device: "cell",
      consecNbr: "2294476",
    });
  });

  it("FR-12: parses a value on the same line as its label", () => {
    expect(parseBody("CONSEC_NBR: 123\ncell name : C1\nALARM_Device: dev").consecNbr).toBe("123");
    expect(parseBody("CONSEC_NBR: 123\ncell name : C1\nALARM_Device: dev")).toMatchObject({ cellName: "C1", device: "dev" });
  });

  it("FR-12: empty or missing CONSEC_NBR parses as null", () => {
    expect(parseBody(body("")).consecNbr).toBeNull();
    expect(parseBody(body(undefined)).consecNbr).toBeNull();
  });

  it.each([
    ["2294476", true],
    ["0", true],
    ["N/A", false],
    ["12a", false],
    ["-1", false],
    ["1.5", false],
    ["", false],
  ])("FR-12: isNumericConsec(%j) → %s", (v, ok) => {
    expect(isNumericConsec(v)).toBe(ok);
  });

  it("FR-12: isNumericConsec(null) → false", () => {
    expect(isNumericConsec(null)).toBe(false);
  });
});

describe("parseMessage uses consecNbr / cellName / device only when CONSEC_NBR is numeric (FR-11, FR-12)", () => {
  it("FR-12: numeric CONSEC_NBR → consecNbr, cellName, device used; FR-11: cellName appended to alarmKey", () => {
    const m = parseMessage(subject, body("2294476"));
    expect(m).toMatchObject({
      format: "HASH",
      consecNbr: "2294476",
      cellName: cell,
      device: "cell",
      alarmKey: `${keyNoCell}||${cell}`,
    });
  });

  it.each([
    ["non-numeric N/A", "N/A"],
    ["non-numeric 12a", "12a"],
    ["empty", ""],
    ["missing", undefined],
  ])("FR-12: %s CONSEC_NBR → consecNbr, cellName, device not used; FR-11: alarmKey has no cell", (_label, consec) => {
    const m = parseMessage(subject, body(consec));
    expect("error" in m).toBe(false);
    const r = m as unknown as Record<string, unknown>;
    // parseMessage leaves the fields absent; the engine stores them as null (see engine/supersede.test.ts).
    expect(r.consecNbr ?? null).toBeNull();
    expect(r.cellName ?? null).toBeNull();
    expect(r.device ?? null).toBeNull();
    expect(r.alarmKey).toBe(keyNoCell);
  });
});
