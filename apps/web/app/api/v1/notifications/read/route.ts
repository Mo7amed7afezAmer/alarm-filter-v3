import { route } from "@/lib/api";
import { db } from "@/lib/db";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-46: "Mark all read" sets notificationsSeenAt.
export const POST = route({ minRole: "VIEWER" }, async ({ user }) => {
  const seenAt = new Date();
  await db.user.update({ where: { id: user.id }, data: { notificationsSeenAt: seenAt } });
  return { notificationsSeenAt: seenAt };
});
