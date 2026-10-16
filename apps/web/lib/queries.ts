import { siteCodeOf, type DisplayFilter } from "@alarm/core";
import type { Prisma, PrismaClient } from "@alarm/db";

export interface AlarmFilters {
  category?: "DOWN" | "POWER" | "OTHER";
  /** Case-insensitive substring of the site. */
  site?: string;
  /** Last 2 characters of the site code (decided 2026-10-16). */
  region?: string;
}

export interface WhereArgs {
  status: "active" | "cleared";
  office: string | null;
  hidden: DisplayFilter;
  filters: AlarmFilters;
  /** FR-30: active alarms at least this many hours old. */
  minHours?: number;
  /** FR-31: clearTime window, default the last 24 h. */
  from?: Date;
  to?: Date;
  now: Date;
}

export interface ListArgs extends WhereArgs {
  page: number;
  pageSize: number;
}

/** FR-30 / FR-31 / FR-40 / FR-41 / FR-42: the shared WHERE of the alarm lists. */
export async function alarmWhere(db: PrismaClient, args: WhereArgs): Promise<Prisma.AlarmWhereInput> {
  const and: Prisma.AlarmWhereInput[] = [{ office: args.office }];
  if (args.hidden.categories.length) and.push({ category: { notIn: args.hidden.categories } });
  if (args.hidden.alarmNames.length) and.push({ alarmName: { notIn: args.hidden.alarmNames } });
  if (args.filters.category) and.push({ category: args.filters.category });
  if (args.filters.site) and.push({ site: { contains: args.filters.site, mode: "insensitive" } });
  if (args.filters.region) {
    // The site code is the last `_` segment shaped ^[0-9A-Z]{3,6}[A-Z]{2}$ (FR-32); region = its last 2 chars.
    const pattern = `(^|_)[0-9A-Z]{3,6}${args.filters.region}$`;
    const rows = await db.$queryRaw<{ id: number }[]>`SELECT id FROM alarms WHERE site ~ ${pattern}`;
    and.push({ id: { in: rows.map((r) => r.id) } });
  }
  if (args.status === "active") {
    and.push({ status: "ACTIVE" });
    if (args.minHours !== undefined) {
      and.push({ alarmTime: { lte: new Date(args.now.getTime() - args.minHours * 3600_000) } });
    }
  } else {
    const to = args.to ?? args.now;
    const from = args.from ?? new Date(args.now.getTime() - 24 * 3600_000);
    and.push({ status: "CLEARED", clearTime: { gte: from, lte: to } });
  }
  return { AND: and };
}

export interface SiteInfo {
  siteCode: string | null;
  vip: boolean | null;
  nodality: string | null;
  battery: string | null;
  phone: string | null;
  siteType: string | null;
  powerSource: string | null;
}

/** FR-32: Site Master data for each alarm (null when not imported). */
export async function withSiteInfo<T extends { site: string }>(db: PrismaClient, alarms: T[]): Promise<(T & SiteInfo)[]> {
  const codes = [...new Set(alarms.map((a) => siteCodeOf(a.site)).filter((c): c is string => c !== null))];
  const rows = codes.length ? await db.siteMaster.findMany({ where: { code: { in: codes } } }) : [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return alarms.map((a) => {
    const siteCode = siteCodeOf(a.site);
    const sm = siteCode ? byCode.get(siteCode) : undefined;
    return {
      ...a,
      siteCode,
      vip: sm ? sm.vip : null,
      nodality: sm?.nodality ?? null,
      battery: sm?.battery ?? null,
      phone: sm?.phone ?? null,
      siteType: sm?.siteType ?? null,
      powerSource: sm?.powerSource ?? null,
    };
  });
}

export const ALARM_SELECT = {
  id: true,
  alarmKey: true,
  alarmName: true,
  site: true,
  category: true,
  alarmTime: true,
  status: true,
  clearTime: true,
  durationMin: true,
  clearType: true,
  consecNbr: true,
  cellName: true,
  device: true,
  office: true,
} as const;

export function alarmOrder(status: "active" | "cleared"): Prisma.AlarmOrderByWithRelationInput[] {
  return status === "active" ? [{ alarmTime: "desc" }, { id: "desc" }] : [{ clearTime: "desc" }, { id: "desc" }];
}

export async function listAlarms(db: PrismaClient, args: ListArgs) {
  const where = await alarmWhere(db, args);
  const [total, rows] = await Promise.all([
    db.alarm.count({ where }),
    db.alarm.findMany({
      where,
      orderBy: alarmOrder(args.status),
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
      select: ALARM_SELECT,
    }),
  ]);
  return { total, page: args.page, pageSize: args.pageSize, items: await withSiteInfo(db, rows) };
}
