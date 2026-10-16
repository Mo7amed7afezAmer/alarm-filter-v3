import { CATEGORIES, normalizeDisplayFilter } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";

// FR-42: each user hides categories and alarm names from their own views.
const body = z.object({
  categories: z.array(z.enum(CATEGORIES as unknown as ["DOWN", "POWER", "OTHER"])),
  alarmNames: z.array(z.string().min(1)),
});

export const GET = route({ minRole: "VIEWER" }, async ({ user }) => {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { displayPrefs: true } });
  return normalizeDisplayFilter(row?.displayPrefs);
});

export const PUT = route({ minRole: "VIEWER", body }, async ({ user, body }) => {
  const prefs = normalizeDisplayFilter(body);
  await db.user.update({ where: { id: user.id }, data: { displayPrefs: { ...prefs } } });
  return prefs;
});
