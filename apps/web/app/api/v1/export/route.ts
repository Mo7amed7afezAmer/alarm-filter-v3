import { z } from "zod";
import * as XLSX from "xlsx";
import { ApiError, route } from "@/lib/api";
import { formatLocal } from "@/lib/date-param";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { alarmFilters, isoDate, pagination } from "@/lib/params";
import { ALARM_SELECT, alarmOrder, alarmWhere, withSiteInfo } from "@/lib/queries";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

/** NFR-09: export cap. */
const MAX_ROWS = 50_000;

// FR-35: export active or cleared alarms (same filters as the lists) to .xlsx. page/pageSize are
// accepted and ignored: the export holds every matching row.
const query = z.object({
  status: z.enum(["active", "cleared"]),
  ...alarmFilters,
  minHours: z.coerce.number().min(0).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination,
});

const BASE = [
  "Alarm",
  "Category",
  "Site",
  "Site code",
  "Cell",
  "Device",
  "CONSEC_NBR",
  "Region",
  "VIP",
  "Nodality",
  "Battery",
  "Phone",
  "Site type",
  "Power source",
  "Alarm time",
];
const HEADER = { active: [...BASE, "Age (min)"], cleared: [...BASE, "Clear time", "Duration (min)", "Clear type"] };
const SHEET = { active: "Active alarms", cleared: "Cleared alarms" };

export const GET = route({ minRole: "VIEWER", query }, async ({ user, query: q }) => {
  const now = new Date();
  const [office, hidden] = await Promise.all([getOffice(db), getEffectiveFilter(db, user.id)]);
  const where = await alarmWhere(db, {
    status: q.status,
    office,
    hidden,
    filters: { category: q.category, site: q.site, region: q.region },
    minHours: q.status === "active" ? q.minHours : undefined,
    from: q.from,
    to: q.to,
    now,
  });

  const total = await db.alarm.count({ where });
  if (total > MAX_ROWS) {
    throw new ApiError(413, "TOO_MANY_ROWS", `${total} rows match; the export is limited to ${MAX_ROWS}. Narrow the filters.`);
  }
  const alarms = await withSiteInfo(db, await db.alarm.findMany({ where, orderBy: alarmOrder(q.status), select: ALARM_SELECT }));

  const rows = alarms.map((a) => {
    const base = [
      a.alarmName,
      a.category,
      a.site,
      a.siteCode,
      a.cellName,
      a.device,
      a.consecNbr,
      a.siteCode ? a.siteCode.slice(-2) : null,
      a.vip === null ? null : a.vip ? "YES" : "NO",
      a.nodality,
      a.battery,
      a.phone,
      a.siteType,
      a.powerSource,
      formatLocal(a.alarmTime),
    ];
    return q.status === "active"
      ? [...base, Math.floor((now.getTime() - a.alarmTime.getTime()) / 60_000)]
      : [...base, a.clearTime ? formatLocal(a.clearTime) : null, a.durationMin, a.clearType];
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER[q.status], ...rows]), SHEET[q.status]);
  const file = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = formatLocal(now).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="alarms-${q.status}-${stamp}.xlsx"`,
    },
  });
});
