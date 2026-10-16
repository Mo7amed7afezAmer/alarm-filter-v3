import { zonedToUtc } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { alarmTz, localDay } from "@/lib/date-param";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { days } from "@/lib/params";
import { scopeWhere } from "@/lib/stats";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-37: alarm counts per category for each of the last `days` local days in ALARM_TZ (by
// alarmTime, oldest first, zero days included).
export const GET = route({ minRole: "VIEWER", query: z.object({ days }) }, async ({ user, query }) => {
  const tz = alarmTz();
  const [office, hidden] = await Promise.all([getOffice(db), getEffectiveFilter(db, user.id)]);

  const [y, m, d] = localDay(new Date(), tz).split("-").map(Number) as [number, number, number];
  const labels: string[] = [];
  for (let i = query.days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    labels.push(day.toISOString().slice(0, 10));
  }
  const [fy, fm, fd] = labels[0]!.split("-").map(Number) as [number, number, number];
  const start = zonedToUtc(fy, fm, fd, 0, 0, 0, tz);

  const alarms = await db.alarm.findMany({
    where: { AND: [scopeWhere(office, hidden), { alarmTime: { gte: start } }] },
    select: { alarmTime: true, category: true },
  });
  const buckets = new Map(labels.map((day) => [day, { day, DOWN: 0, POWER: 0, OTHER: 0 }]));
  for (const a of alarms) {
    const b = buckets.get(localDay(a.alarmTime, tz));
    if (b) b[a.category]++;
  }
  return { days: [...buckets.values()] };
});
