import { z } from "zod";
import { notFound, route } from "@/lib/api";
import { hashToken, newToken } from "@/lib/api-tokens";
import { db } from "@/lib/db";

// P3-T07: an ADMIN creates an API token for a user; the token is returned once, only its hash is kept.
export const POST = route(
  { minRole: "ADMIN", body: z.object({ userId: z.number().int().positive(), name: z.string().trim().min(1).max(100) }) },
  async ({ body }) => {
    const user = await db.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) throw notFound(`user ${body.userId} not found`);
    const token = newToken();
    const row = await db.apiToken.create({
      data: { name: body.name, userId: user.id, tokenHash: hashToken(token) },
      select: { id: true, name: true, userId: true, createdAt: true },
    });
    return Response.json({ ...row, token }, { status: 201 });
  },
);
