import { CATEGORIES, type Category } from "./classify";

/**
 * Hidden alarm types: categories and exact alarm names.
 * FR-41: the admin filter (`system_status.displayFilter`) applies to everyone.
 * FR-42: a user's own filter (`users.displayPrefs`) is merged on top; it cannot un-hide.
 */
export interface DisplayFilter {
  categories: Category[];
  alarmNames: string[];
}

export const EMPTY_DISPLAY_FILTER: DisplayFilter = { categories: [], alarmNames: [] };

/** Reads a stored JSON value into a filter, dropping anything that is not valid. */
export function normalizeDisplayFilter(value: unknown): DisplayFilter {
  if (!value || typeof value !== "object") return { categories: [], alarmNames: [] };
  const v = value as { categories?: unknown; alarmNames?: unknown };
  const categories = Array.isArray(v.categories)
    ? v.categories.filter((c): c is Category => CATEGORIES.includes(c as Category))
    : [];
  const alarmNames = Array.isArray(v.alarmNames)
    ? v.alarmNames.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];
  return { categories: [...new Set(categories)], alarmNames: [...new Set(alarmNames)] };
}

export function effectiveDisplayFilter(admin: DisplayFilter, user: DisplayFilter): DisplayFilter {
  return {
    categories: [...new Set([...admin.categories, ...user.categories])],
    alarmNames: [...new Set([...admin.alarmNames, ...user.alarmNames])],
  };
}

export function isHidden(alarm: { category: Category; alarmName: string }, filter: DisplayFilter): boolean {
  return filter.categories.includes(alarm.category) || filter.alarmNames.includes(alarm.alarmName);
}
