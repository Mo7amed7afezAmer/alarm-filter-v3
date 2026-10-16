// FR-56: base normalization (collapse spaces, trim, upper-case) of the filter fields, then
// whole-token replacements per field or `*`, longest first; alarmName rules also apply to Alarm
// Text and Supplementary Information. No default rules (decided 2026-10-17).

/** The fields that are normalized (decided 2026-10-17). */
export const NORMALIZED_FIELDS = [
  "alarmName",
  "alarmText",
  "supplementaryInfo",
  "siteName",
  "office",
  "siteType",
  "nodality",
  "powerSource",
] as const;
export type NormalizedField = (typeof NORMALIZED_FIELDS)[number];

/** A row of hourly_normalizations: `field` is a normalized field or `*`. */
export interface NormalizationRule {
  field: string;
  from: string;
  to: string;
}

export function baseNormalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

/** FR-56: rules on alarmName also apply to these fields. */
const FIELD_ALIASES: Partial<Record<NormalizedField, NormalizedField>> = {
  alarmText: "alarmName",
  supplementaryInfo: "alarmName",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Replacer = (value: string) => string;

function replacerFor(rules: NormalizationRule[]): Replacer {
  const list = rules
    .map((r) => ({ from: baseNormalize(r.from), to: baseNormalize(r.to) }))
    .filter((r) => r.from)
    .sort((a, b) => b.from.length - a.from.length);
  if (!list.length) return (v) => v;
  const to = new Map(list.map((r) => [r.from, r.to]));
  // Whole tokens: the match starts and ends at a space or the edge of the text.
  const re = new RegExp(`(^| )(${list.map((r) => escape(r.from)).join("|")})(?= |$)`, "g");
  return (v) => v.replace(re, (_m, lead: string, hit: string) => lead + (to.get(hit) ?? hit));
}

/** Builds the row normalizer for a set of rules (hourly_normalizations). */
export function compileNormalizer(rules: NormalizationRule[]) {
  const replacers = new Map<NormalizedField, Replacer>(
    NORMALIZED_FIELDS.map((f) => {
      const owner = FIELD_ALIASES[f] ?? f;
      return [f, replacerFor(rules.filter((r) => r.field === "*" || r.field === owner || r.field === f))];
    }),
  );
  return <R extends Partial<Record<NormalizedField, string | null>>>(row: R): R => {
    const out = { ...row };
    for (const f of NORMALIZED_FIELDS) {
      const v = out[f];
      if (typeof v === "string") (out as Record<string, unknown>)[f] = replacers.get(f)!(baseNormalize(v));
    }
    return out;
  };
}
