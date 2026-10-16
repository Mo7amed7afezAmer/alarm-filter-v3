import { matchesPrefs, normalizePrefs } from "@alarm/core";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { scopeWhere } from "@/lib/stats";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

/** FR-44 limits. */
const WINDOW_MS = 24 * 3600_000;
const FEED_LIMIT = 50;
const SCAN_LIMIT = 2000;
const FIRST_SEEN_MS = 30 * 60_000;

// FR-44: computed on read — alarms created in the last 24 h in the user's scope (office, hidden
// types) that match their prefs; unread = createdAt > notificationsSeenAt (first time: the last
// 30 minutes).
export const GET = route({ minRole: "VIEWER" }, async ({ user }) => {
  const now = Date.now();
  const [office, hidden, me] = await Promise.all([
    getOffice(db),
    getEffectiveFilter(db, user.id),
    db.user.findUnique({ where: { id: user.id }, select: { notifyPrefs: true, notificationsSeenAt: true } }),
  ]);
  const prefs = normalizePrefs(me?.notifyPrefs);
  const seenAt = me?.notificationsSeenAt ?? new Date(now - FIRST_SEEN_MS);

  const scanned = prefs.enabled
    ? await db.alarm.findMany({
        where: { AND: [scopeWhere(office, hidden), { createdAt: { gte: new Date(now - WINDOW_MS) } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SCAN_LIMIT,
        select: { id: true, alarmName: true, site: true, category: true, alarmTime: true, status: true, createdAt: true },
      })
    : [];
  const matching = scanned.filter((a) => matchesPrefs(a, prefs));

  return {
    unread: matching.filter((a) => a.createdAt > seenAt).length,
    sound: prefs.sound,
    items: matching.slice(0, FEED_LIMIT).map((a) => ({ ...a, unread: a.createdAt > seenAt })),
  };
});
