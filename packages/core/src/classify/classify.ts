export type Category = "DOWN" | "POWER" | "OTHER";

export const CATEGORIES: readonly Category[] = ["DOWN", "POWER", "OTHER"];

/** A row of the `rules` table. */
export interface ClassifyRule {
  pattern: string;
  category: Category;
  priority: number;
}

/**
 * FR-15: the category of the first rule (ascending `priority`) whose `pattern` is a
 * case-insensitive substring of `alarmName`; OTHER when none matches.
 */
export function classify(alarmName: string, rules: readonly ClassifyRule[]): Category {
  const name = alarmName.toUpperCase();
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (name.includes(rule.pattern.toUpperCase())) return rule.category;
  }
  return "OTHER";
}
