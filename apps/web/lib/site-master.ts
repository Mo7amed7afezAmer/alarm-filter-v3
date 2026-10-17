// G-T15: Site Master (FR-65 … FR-67) and hourly normalizations (FR-68) shared by the routes.
import type { Prisma } from "@alarm/db";

/** NFR-25: Site Master uploads ≤ 5 MB. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** The site_master columns the API returns (all but updatedAt). */
export const siteSelect = {
  code: true,
  siteName: true,
  office: true,
  nodality: true,
  vip: true,
  siteType: true,
  powerSource: true,
  battery: true,
  phone: true,
  region: true,
  notes: true,
} satisfies Prisma.SiteMasterSelect;

export const ruleSelect = { field: true, from: true, to: true } satisfies Prisma.HourlyNormalizationSelect;

/**
 * Marks the hourly reference data as changed: its ETag is system_status.referenceUpdatedAt
 * (decided 2026-10-17; replaces "the hourly cache is cleared" of FR-65 / FR-68 under D-10).
 */
export async function touchReference(tx: Prisma.TransactionClient): Promise<void> {
  const referenceUpdatedAt = new Date();
  await tx.systemStatus.upsert({ where: { id: 1 }, create: { id: 1, referenceUpdatedAt }, update: { referenceUpdatedAt } });
}
