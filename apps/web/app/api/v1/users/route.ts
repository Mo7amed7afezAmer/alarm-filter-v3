import bcrypt from "bcryptjs";
import { z } from "zod";
import { conflict, route } from "@/lib/api";
import { db } from "@/lib/db";
import { BCRYPT_ROUNDS, password, publicUser, role } from "@/lib/users";

// FR-28: ADMIN lists and creates users.
export const GET = route({ minRole: "ADMIN" }, async () => ({
  users: await db.user.findMany({ select: publicUser, orderBy: { email: "asc" } }),
}));

export const POST = route(
  { minRole: "ADMIN", body: z.object({ email: z.string().trim().email(), password, role }) },
  async ({ body }) => {
    const exists = await db.user.findFirst({ where: { email: { equals: body.email, mode: "insensitive" } } });
    if (exists) throw conflict(`a user with e-mail ${body.email} already exists`);
    const user = await db.user.create({
      data: { email: body.email, role: body.role, passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS) },
      select: publicUser,
    });
    return Response.json({ user }, { status: 201 });
  },
);
