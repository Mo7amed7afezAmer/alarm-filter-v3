import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { getDisplayFilter, getUserFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const LIMIT = 300;

// FR-43: alarm names of the last 30 days in the current office (≤ 300, most frequent first),
// flagged when hidden by the admin (`hidden`) or by the user (`hiddenByMe`).
export const GET = route({ minRole: "VIEWER" }, async ({ user }) => {
  const office = await getOffice(db);
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [groups, admin, mine] = await Promise.all([
    db.alarm.groupBy({
      by: ["alarmName"],
      where: { office, alarmTime: { gte: since } },
      _count: { _all: true },
      orderBy: [{ _count: { alarmName: "desc" } }, { alarmName: "asc" }],
      take: LIMIT,
    }),
    getDisplayFilter(db),
    getUserFilter(db, user.id),
  ]);
  return {
    names: groups.map((g) => ({
      alarmName: g.alarmName,
      count: g._count._all,
      hidden: admin.alarmNames.includes(g.alarmName),
      hiddenByMe: mine.alarmNames.includes(g.alarmName),
    })),
  };
});
