import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { getOffice } from "@/lib/office";
import { alarmFilters, isoDate, pagination } from "@/lib/params";
import { listAlarms } from "@/lib/queries";
import { getEffectiveFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-30 (active) / FR-31 (cleared) with Site Master data (FR-32), scoped to the office (FR-40),
// without hidden alarm types (FR-41, FR-42).
const query = z.object({
  status: z.enum(["active", "cleared"]),
  ...alarmFilters,
  minHours: z.coerce.number().min(0).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination,
});

export const GET = route({ minRole: "VIEWER", query }, async ({ user, query: q }) => {
  const [office, hidden] = await Promise.all([getOffice(db), getEffectiveFilter(db, user.id)]);
  return listAlarms(db, {
    status: q.status,
    office,
    hidden,
    filters: { category: q.category, site: q.site, region: q.region },
    minHours: q.status === "active" ? q.minHours : undefined,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
    now: new Date(),
  });
});
