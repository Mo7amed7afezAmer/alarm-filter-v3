import { z } from "zod";
import { notFound, route } from "@/lib/api";
import { db } from "@/lib/db";

// P3-T07: revoke an API token (the row is kept with revokedAt; revoking again is a no-op).
export const DELETE = route({ minRole: "ADMIN", params: z.object({ id: z.coerce.number().int().positive() }) }, async ({ params }) => {
  const token = await db.apiToken.findUnique({ where: { id: params.id }, select: { revokedAt: true } });
  if (!token) throw notFound(`API token ${params.id} not found`);
  if (!token.revokedAt) await db.apiToken.update({ where: { id: params.id }, data: { revokedAt: new Date() } });
  return new Response(null, { status: 204 });
});
