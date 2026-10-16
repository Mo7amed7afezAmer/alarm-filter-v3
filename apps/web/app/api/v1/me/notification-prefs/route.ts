import { CATEGORIES, normalizePrefs } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-45: per-user notification prefs.
const body = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  categories: z.array(z.enum(CATEGORIES as unknown as ["DOWN", "POWER", "OTHER"])),
  alarmNames: z.array(z.string().min(1)),
  sites: z.array(z.string().min(1)),
});

export const GET = route({ minRole: "VIEWER" }, async ({ user }) => {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { notifyPrefs: true } });
  return normalizePrefs(row?.notifyPrefs);
});

export const PUT = route({ minRole: "VIEWER", body }, async ({ user, body }) => {
  const prefs = normalizePrefs(body);
  await db.user.update({ where: { id: user.id }, data: { notifyPrefs: { ...prefs } } });
  return prefs;
});
