import { isNumericConsec, parseBody } from "./body";
import { parseSubject, type HashSubject, type HuaweiSubject, type SubjectError } from "./subject";
import { DEFAULT_ALARM_TZ } from "./time";

/** FR-11: `alarmName||site`, plus `||cellName` when the body has a cell; never the time. */
export function makeAlarmKey(alarmName: string, site: string, cellName?: string | null): string {
  return cellName ? `${alarmName}||${site}||${cellName}` : `${alarmName}||${site}`;
}

export interface HashMessage extends HashSubject {
  consecNbr?: string;
  device?: string | null;
  cellName?: string;
  alarmKey: string;
}

export type ParsedMessage = HashMessage | HuaweiSubject | SubjectError;

export function parseMessage(subject: string, body: string | null, tz: string = DEFAULT_ALARM_TZ): ParsedMessage {
  const parsed = parseSubject(subject, tz);
  if (!("format" in parsed) || parsed.format === "HUAWEI") return parsed;

  const out: HashMessage = { ...parsed, alarmKey: "" };
  let cellName: string | null = null;
  if (body !== null) {
    const b = parseBody(body);
    if (isNumericConsec(b.consecNbr)) {
      out.consecNbr = b.consecNbr;
      out.device = b.device;
      if (b.cellName) out.cellName = cellName = b.cellName;
    }
  }
  out.alarmKey = makeAlarmKey(out.alarmName, out.site, cellName);
  return out;
}
