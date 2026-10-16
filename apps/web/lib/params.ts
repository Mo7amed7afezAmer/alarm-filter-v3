import { CATEGORIES } from "@alarm/core";
import { z } from "zod";
import { parseDateParam } from "./date-param";

/** NFR-05: pageSize 1–500, default 50. */
export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
};

export const category = z.enum(CATEGORIES as unknown as ["DOWN", "POWER", "OTHER"]);

/** A date parameter: `YYYY-MM-DD` = local midnight in ALARM_TZ, or a full ISO timestamp (NFR-29). */
export const isoDate = z.string().transform((s, ctx) => {
  const d = parseDateParam(s);
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected YYYY-MM-DD or an ISO timestamp" });
    return z.NEVER;
  }
  return d;
});

/** A whole number of days (FR-36 … FR-38): 1–365, default 30. */
export const days = z.coerce.number().int().min(1).max(365).default(30);

export const alarmFilters = {
  category: category.optional(),
  site: z.string().trim().min(1).optional(),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{2}$/))
    .optional(),
};
