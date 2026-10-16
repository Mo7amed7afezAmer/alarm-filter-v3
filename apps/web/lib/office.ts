import type { PrismaClient } from "@alarm/db";

/**
 * FR-40: the office every view is scoped to — system_status.officeLabel, or (no office selected)
 * the first GMAIL_LABELS entry, the label the worker reads (FR-07; decided 2026-10-16).
 */
export async function getOffice(db: PrismaClient): Promise<string | null> {
  const status = await db.systemStatus.findUnique({ where: { id: 1 }, select: { officeLabel: true } });
  if (status?.officeLabel) return status.officeLabel;
  const first = (process.env.GMAIL_LABELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .find(Boolean);
  return first ?? null;
}
