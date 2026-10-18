import { CATEGORIES, type Category } from "../classify";

/**
 * FR-45: per-user notification prefs — enabled, sound, categories, exact alarm names and site
 * substrings. OR within a filter, AND across filters; an empty filter does not restrict.
 */
export interface NotifyPrefs {
  enabled: boolean;
  sound: boolean;
  categories: Category[];
  alarmNames: string[];
  sites: string[];
}

/** FR-45: DOWN only by default. */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  sound: false,
  categories: ["DOWN"],
  alarmNames: [],
  sites: [],
};

const strings = (v: unknown, trim: boolean): string[] | undefined =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((s): s is string => typeof s === "string")
            .map((s) => (trim ? s.trim() : s))
            .filter(Boolean),
        ),
      ]
    : undefined;

/** Reads a stored JSON value into prefs; missing or invalid fields take the default. */
export function normalizePrefs(value: unknown): NotifyPrefs {
  if (!value || typeof value !== "object") return { ...DEFAULT_NOTIFY_PREFS };
  const v = value as Record<string, unknown>;
  const categories = Array.isArray(v.categories)
    ? [...new Set(v.categories.filter((c): c is Category => CATEGORIES.includes(c as Category)))]
    : undefined;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_NOTIFY_PREFS.enabled,
    sound: typeof v.sound === "boolean" ? v.sound : DEFAULT_NOTIFY_PREFS.sound,
    categories: categories ?? [...DEFAULT_NOTIFY_PREFS.categories],
    alarmNames: strings(v.alarmNames, false) ?? [],
    sites: strings(v.sites, true) ?? [],
  };
}

export function matchesPrefs(alarm: { category: Category; alarmName: string; site: string }, prefs: NotifyPrefs): boolean {
  if (!prefs.enabled) return false;
  if (prefs.categories.length && !prefs.categories.includes(alarm.category)) return false;
  if (prefs.alarmNames.length && !prefs.alarmNames.includes(alarm.alarmName)) return false;
  if (prefs.sites.length) {
    const site = alarm.site.toUpperCase();
    if (!prefs.sites.some((s) => site.includes(s.toUpperCase()))) return false;
  }
  return true;
}
