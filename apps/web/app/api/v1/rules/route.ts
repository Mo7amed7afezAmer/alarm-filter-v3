import { classify } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { category } from "@/lib/params";

// Reads the session and the database on every request.
export const dynamic = "force-dynamic";

// FR-17: an ADMIN replaces all rules (≤ 500, pattern 1–100 chars, priority 0–100000); every existing
// alarm, in every office (gap 18), is re-classified in the same transaction.
const rule = z.object({
  pattern: z.string().trim().min(1).max(100),
  category,
  priority: z.number().int().min(0).max(100_000),
});
const body = z.object({ rules: z.array(rule).max(500) });

const select = { id: true, pattern: true, category: true, priority: true } as const;

export const GET = route({ minRole: "ADMIN" }, async () => ({
  rules: await db.rule.findMany({ select, orderBy: [{ priority: "asc" }, { id: "asc" }] }),
}));

export const PUT = route({ minRole: "ADMIN", body, idempotent: true }, async ({ body }) => {
  const rules = await db.$transaction(
    async (tx) => {
      await tx.rule.deleteMany();
      if (body.rules.length) await tx.rule.createMany({ data: body.rules });

      const names = await tx.alarm.groupBy({ by: ["alarmName", "category"] });
      for (const { alarmName, category: current } of names) {
        const next = classify(alarmName, body.rules);
        if (next !== current) await tx.alarm.updateMany({ where: { alarmName, category: current }, data: { category: next } });
      }
      return tx.rule.findMany({ select, orderBy: [{ priority: "asc" }, { id: "asc" }] });
    },
    { timeout: 5 * 60_000, maxWait: 60_000 },
  );
  return { rules };
});
