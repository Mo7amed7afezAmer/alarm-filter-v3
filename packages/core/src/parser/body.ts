// FR-12: alarm e-mail body labels. Each value follows its label, on the same line or the next one.

export interface ParsedBody {
  alarmName: string | null;
  startTime: string | null;
  neName: string | null;
  alarmNumber: string | null;
  site: string | null;
  cellName: string | null;
  device: string | null;
  consecNbr: string | null;
}

const LABELS: Record<keyof ParsedBody, string> = {
  alarmName: "ALARM NAME",
  startTime: "ALARM_START_TIME",
  neName: "NE_name",
  alarmNumber: "Alarm_Number",
  site: "ALARM_SITE",
  cellName: "cell name",
  device: "ALARM_Device",
  consecNbr: "CONSEC_NBR",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function valueOf(lines: string[], label: string): string | null {
  const re = new RegExp(`^\\s*${escape(label)}\\s*:?\\s*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    const sameLine = m[1]!.trim();
    if (sameLine) return sameLine;
    const next = lines[i + 1]?.trim();
    return next ? next : null;
  }
  return null;
}

export function parseBody(body: string): ParsedBody {
  const lines = body.split(/\r?\n/);
  const out = {} as ParsedBody;
  for (const [field, label] of Object.entries(LABELS) as [keyof ParsedBody, string][]) {
    out[field] = valueOf(lines, label);
  }
  return out;
}

/** FR-12: body fields are used only when CONSEC_NBR is numeric. */
export function isNumericConsec(consecNbr: string | null): consecNbr is string {
  return consecNbr !== null && /^\d+$/.test(consecNbr);
}
