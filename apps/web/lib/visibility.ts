import { effectiveDisplayFilter, normalizeDisplayFilter, type DisplayFilter } from "@alarm/core";
import type { PrismaClient } from "@alarm/db";

/** FR-41: the admin list of hidden categories and alarm names (system_status.displayFilter). */
export async function getDisplayFilter(db: PrismaClient): Promise<DisplayFilter> {
  const status = await db.systemStatus.findUnique({ where: { id: 1 }, select: { displayFilter: true } });
  return normalizeDisplayFilter(status?.displayFilter);
}

/** The user's own list (users.displayPrefs). */
export async function getUserFilter(db: PrismaClient, userId: number): Promise<DisplayFilter> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { displayPrefs: true } });
  return normalizeDisplayFilter(user?.displayPrefs);
}

/** FR-42: the admin list merged with the user's own list; a user cannot un-hide. */
export async function getEffectiveFilter(db: PrismaClient, userId: number): Promise<DisplayFilter> {
  const [admin, user] = await Promise.all([getDisplayFilter(db), getUserFilter(db, userId)]);
  return effectiveDisplayFilter(admin, user);
}
