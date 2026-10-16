import { normalizeDisplayFilter } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { category } from "@/lib/params";
import { getDisplayFilter } from "@/lib/visibility";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-41: an ADMIN hides categories and exact alarm names for all users.
const body = z.object({ categories: z.array(category), alarmNames: z.array(z.string().min(1)) });

export const GET = route({ minRole: "ADMIN" }, async () => getDisplayFilter(db));

export const PUT = route({ minRole: "ADMIN", body }, async ({ body }) => {
  const filter = normalizeDisplayFilter(body);
  await db.systemStatus.upsert({
    where: { id: 1 },
    create: { id: 1, displayFilter: { ...filter } },
    update: { displayFilter: { ...filter } },
  });
  return filter;
});
