import { DEFAULT_ALARM_TZ, parseAlarmStamp } from "./time";

export const UNRECOGNISED = "unrecognised subject format";

/** FR-10: `[CLEARED_]<name> on #<site># at |DD-MON-YYYY HH:mm:ss|`. */
const HASH_RE = /^(CLEARED_)?(.+?) on #(.+?)# at \|(.+?)\|$/i;

/** FR-13: `Huawei Alram Notify New alarm: <NE>/<alarm>/<severity>`. */
const HUAWEI_RE = /^Huawei Alram Notify New alarm: (.*)\/(.*)\/(.*)$/;

export interface HashSubject {
  format: "HASH";
  isClear: boolean;
  alarmName: string;
  /** Text after `;` in the name; absent when there is none. */
  nameSuffix?: string;
  site: string;
  alarmTime: Date;
}

export interface HuaweiSubject {
  format: "HUAWEI";
  isClear: false;
  ne: string;
  alarmName: string;
  severity: string;
  alarmTime: null;
}

export interface SubjectError {
  error: string;
}

export type ParsedSubject = HashSubject | HuaweiSubject | SubjectError;

export function parseSubject(subject: string, tz: string = DEFAULT_ALARM_TZ): ParsedSubject {
  const s = subject.replace(/\s+/g, " ").trim();

  const huawei = HUAWEI_RE.exec(s);
  if (huawei) {
    const [, ne, alarmName, severity] = huawei;
    return { format: "HUAWEI", isClear: false, ne: ne!.trim(), alarmName: alarmName!.trim(), severity: severity!.trim(), alarmTime: null };
  }

  const m = HASH_RE.exec(s);
  if (!m) return { error: UNRECOGNISED };
  const [, cleared, rawName, site, stamp] = m;

  const alarmTime = parseAlarmStamp(stamp!, tz);
  if (!alarmTime) return { error: UNRECOGNISED };

  const semi = rawName!.indexOf(";");
  const alarmName = (semi < 0 ? rawName! : rawName!.slice(0, semi)).trim();
  const out: HashSubject = { format: "HASH", isClear: Boolean(cleared), alarmName, site: site!.trim(), alarmTime };
  if (semi >= 0) out.nameSuffix = rawName!.slice(semi + 1).trim();
  return out;
}
