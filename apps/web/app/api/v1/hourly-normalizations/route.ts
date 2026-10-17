import { NORMALIZED_FIELDS } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { ruleSelect, touchReference } from "@/lib/site-master";

export const dynamic = "force-dynamic";

const rule = z.object({
  field: z.enum(["*", ...NORMALIZED_FIELDS]),
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().max(200),
});
const body = z.object({
  rules: z
    .array(rule)
    .max(500)
    .refine((rules) => new Set(rules.map((r) => `${r.field}\u0000${r.from}`)).size === rules.length, "repeated (field, from)"),
});

// FR-68: ADMIN reads and replaces the hourly normalization rules (≤ 500; field `*` or a normalized field).
export const GET = route({ minRole: "ADMIN" }, async () => ({
  rules: await db.hourlyNormalization.findMany({ select: ruleSelect, orderBy: { id: "asc" } }),
}));

export const PUT = route({ minRole: "ADMIN", body }, async ({ body }) => {
  const rules = await db.$transaction(async (tx) => {
    await tx.hourlyNormalization.deleteMany();
    await tx.hourlyNormalization.createMany({ data: body.rules });
    await touchReference(tx);
    return tx.hourlyNormalization.findMany({ select: ruleSelect, orderBy: { id: "asc" } });
  });
  return { rules };
});
