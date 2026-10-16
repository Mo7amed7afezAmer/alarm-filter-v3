import { CATEGORIES } from "@alarm/core";
import { z } from "zod";

/** NFR-05: pageSize 1–500, default 50. */
export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
};

export const category = z.enum(CATEGORIES as unknown as ["DOWN", "POWER", "OTHER"]);

export const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

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
