import { siteCodeOf } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { days } from "@/lib/params";
import { scopeWhere } from "@/lib/stats";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-38: the sites with the most alarms in the last `days` (by alarmTime), with total, active and
// region (last 2 characters of the site code).
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10), days });

export const GET = route({ minRole: "VIEWER", query }, async ({ user, query: q }) => {
  const [office, hidden] = await Promise.all([getOffice(db), getEffectiveFilter(db, user.id)]);
  const where = { AND: [scopeWhere(office, hidden), { alarmTime: { gte: new Date(Date.now() - q.days * 86_400_000) } }] };

  const totals = await db.alarm.groupBy({
    by: ["site"],
    where,
    _count: { _all: true },
    orderBy: [{ _count: { site: "desc" } }, { site: "asc" }],
    take: q.limit,
  });
  const active = await db.alarm.groupBy({
    by: ["site"],
    where: { AND: [where, { status: "ACTIVE" }, { site: { in: totals.map((t) => t.site) } }] },
    _count: { _all: true },
  });
  const activeBySite = new Map(active.map((a) => [a.site, a._count._all]));

  return {
    sites: totals.map((t) => {
      const code = siteCodeOf(t.site);
      return { site: t.site, total: t._count._all, active: activeBySite.get(t.site) ?? 0, region: code ? code.slice(-2) : null };
    }),
  };
});
