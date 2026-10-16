import { z } from "zod";
import { badRequest, route } from "@/lib/api";
import { db } from "@/lib/db";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

const labels = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// FR-40: an ADMIN selects one office from system_status.availableLabels (FR-08).
export const GET = route({ minRole: "ADMIN" }, async () => {
  const status = await db.systemStatus.findUnique({ where: { id: 1 } });
  return { office: status?.officeLabel ?? null, availableLabels: labels(status?.availableLabels) };
});

export const PUT = route({ minRole: "ADMIN", body: z.object({ office: z.string().trim().min(1) }) }, async ({ body }) => {
  const status = await db.systemStatus.findUnique({ where: { id: 1 } });
  const available = labels(status?.availableLabels);
  if (!available.includes(body.office)) throw badRequest(`"${body.office}" is not an available office label`);
  await db.systemStatus.upsert({ where: { id: 1 }, create: { id: 1, officeLabel: body.office }, update: { officeLabel: body.office } });
  return { office: body.office, availableLabels: available };
});
