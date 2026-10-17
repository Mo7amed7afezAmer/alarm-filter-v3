import { baseNormalize } from "@alarm/core";
import { z } from "zod";
import { notFound, route } from "@/lib/api";
import { db } from "@/lib/db";
import { siteSelect, touchReference } from "@/lib/site-master";

export const dynamic = "force-dynamic";

/** Optional text: trimmed, empty → null. */
const text = z
  .string()
  .max(200)
  .transform((s) => s.trim() || null)
  .nullable()
  .optional();

const body = z
  .object({
    siteName: text,
    office: z
      .string()
      .max(200)
      .transform(baseNormalize)
      .refine((s) => s !== "", "office is required")
      .optional(),
    nodality: text,
    vip: z.boolean().optional(),
    siteType: text,
    powerSource: text,
    battery: text,
    // FR-67: phone limited to [\d+ /()-].
    phone: z
      .string()
      .max(200)
      .regex(/^[\d+ /()-]*$/, "phone may contain digits, +, space, /, ( ) and - only")
      .transform((s) => s.trim() || null)
      .nullable()
      .optional(),
    notes: z
      .string()
      .max(2000)
      .transform((s) => s.trim() || null)
      .nullable()
      .optional(),
  })
  .strict();

const params = z.object({ code: z.string().min(1).max(20).transform((s) => s.toUpperCase()) });

// FR-67: ADMIN edits one site (every field but code and region).
export const PUT = route({ minRole: "ADMIN", params, body }, async ({ params: { code }, body }) => {
  if (!(await db.siteMaster.findUnique({ where: { code }, select: { code: true } }))) throw notFound(`site ${code} not found`);
  const site = await db.$transaction(async (tx) => {
    const updated = await tx.siteMaster.update({ where: { code }, data: body, select: siteSelect });
    await touchReference(tx);
    return updated;
  });
  return { site };
});
