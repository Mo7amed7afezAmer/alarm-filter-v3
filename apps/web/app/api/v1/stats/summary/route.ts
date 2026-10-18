import { z } from "zod";
import { alertHoursFrom } from "@/lib/alarm-ui";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { days } from "@/lib/params";
import { CATEGORY_LIST, scopeWhere } from "@/lib/stats";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-36: active counts per category, overdue count (> ALERT_HOURS), MTTR per category (average
// durationMin of EMAIL clears in the last `days`), last-24 h cleared / orphan / parse-error counts,
// office and last worker run. Office-scoped and without hidden types (decided 2026-10-16).
export const GET = route({ minRole: "VIEWER", query: z.object({ days }) }, async ({ user, query }) => {
  const now = Date.now();
  const [office, hidden, status] = await Promise.all([
    getOffice(db),
    getEffectiveFilter(db, user.id),
    db.systemStatus.findUnique({ where: { id: 1 } }),
  ]);
  const scope = scopeWhere(office, hidden);
  const day = new Date(now - 24 * 3600_000);
  const since = new Date(now - query.days * 86_400_000);
  const overdueBefore = new Date(now - alertHoursFrom(process.env.ALERT_HOURS) * 3600_000);

  const [active, overdue, mttr, cleared, orphanClears, parseErrors] = await Promise.all([
    db.alarm.groupBy({ by: ["category"], where: { AND: [scope, { status: "ACTIVE" }] }, _count: { _all: true } }),
    db.alarm.count({ where: { AND: [scope, { status: "ACTIVE", alarmTime: { lt: overdueBefore } }] } }),
    db.alarm.groupBy({
      by: ["category"],
      where: { AND: [scope, { status: "CLEARED", clearType: "EMAIL", clearTime: { gte: since } }] },
      _avg: { durationMin: true },
    }),
    db.alarm.count({ where: { AND: [scope, { status: "CLEARED", clearTime: { gte: day } }] } }),
    db.orphanClear.count({ where: { office, clearTime: { gte: day } } }),
    db.rawMessage.count({ where: { office, parseError: { not: null }, receivedAt: { gte: day } } }),
  ]);

  const byCategory = <T>(rows: { category: string }[], pick: (r: never) => T, empty: T) =>
    Object.fromEntries(
      CATEGORY_LIST.map((c) => {
        const r = rows.find((x) => x.category === c);
        return [c, r ? pick(r as never) : empty];
      }),
    );

  return {
    office,
    active: byCategory(active, (r: { _count: { _all: number } }) => r._count._all, 0),
    overdue,
    mttrMinutes: byCategory(mttr, (r: { _avg: { durationMin: number | null } }) => r._avg.durationMin, null),
    last24h: { cleared, orphanClears, parseErrors },
    lastRun: {
      lastRunAt: status?.lastRunAt ?? null,
      lastRunMessages: status?.lastRunMessages ?? 0,
      lastError: status?.lastError ?? null,
    },
  };
});
