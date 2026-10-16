import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-24: an ADMIN requests reprocess(days) (1–90, default 7); the worker runs it on its next cycle.
const body = z.object({ days: z.number().int().min(1).max(90).default(7) });

export const POST = route({ minRole: "ADMIN", body }, async ({ body }) => {
  await db.systemStatus.upsert({
    where: { id: 1 },
    create: { id: 1, reprocessDays: body.days },
    update: { reprocessDays: body.days },
  });
  return Response.json({ reprocessDays: body.days }, { status: 202 });
});
