import bcrypt from "bcryptjs";
import { z } from "zod";
import { badRequest, notFound, route } from "@/lib/api";
import { db } from "@/lib/db";
import { BCRYPT_ROUNDS, password, publicUser, role, userId } from "@/lib/users";

async function existing(id: number) {
  const user = await db.user.findUnique({ where: { id }, select: publicUser });
  if (!user) throw notFound(`user ${id} not found`);
  return user;
}

// FR-28: change role and/or password; an ADMIN cannot set their own role to VIEWER.
export const PATCH = route(
  {
    minRole: "ADMIN",
    params: userId,
    body: z
      .object({ role: role.optional(), password: password.optional() })
      .refine((b) => b.role !== undefined || b.password !== undefined, "role or password is required"),
  },
  async ({ user: me, params, body }) => {
    await existing(params.id);
    if (params.id === me.id && body.role === "VIEWER") throw badRequest("you cannot set your own role to VIEWER");
    const user = await db.user.update({
      where: { id: params.id },
      data: {
        ...(body.role ? { role: body.role } : {}),
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS) } : {}),
      },
      select: publicUser,
    });
    return { user };
  },
);

// FR-28: delete a user, but not yourself.
export const DELETE = route({ minRole: "ADMIN", params: userId }, async ({ user: me, params }) => {
  await existing(params.id);
  if (params.id === me.id) throw badRequest("you cannot delete yourself");
  await db.user.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
});
