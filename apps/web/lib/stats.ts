import type { DisplayFilter } from "@alarm/core";
import type { Prisma } from "@alarm/db";

/** The office and hidden-type part of every stats query (FR-40, FR-41, FR-42). */
export function scopeWhere(office: string | null, hidden: DisplayFilter): Prisma.AlarmWhereInput {
  const and: Prisma.AlarmWhereInput[] = [{ office }];
  if (hidden.categories.length) and.push({ category: { notIn: hidden.categories } });
  if (hidden.alarmNames.length) and.push({ alarmName: { notIn: hidden.alarmNames } });
  return { AND: and };
}

export const CATEGORY_LIST = ["DOWN", "POWER", "OTHER"] as const;
