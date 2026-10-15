import type { Db, Prisma } from "@alarm/db";

/** FR-09: `lastError` is stored with at most this many characters. */
export const LAST_ERROR_MAX = 2000;

/** The single `system_status` row (id 1), created on first use. */
export async function getStatus(db: Db) {
  const found = await db.systemStatus.findUnique({ where: { id: 1 } });
  if (found) return found;
  try {
    return await db.systemStatus.create({ data: { id: 1 } });
  } catch (err) {
    // Another instance created it first.
    if ((err as { code?: string }).code === "P2002") return db.systemStatus.findUniqueOrThrow({ where: { id: 1 } });
    throw err;
  }
}

export async function updateStatus(db: Db, data: Prisma.SystemStatusUpdateInput): Promise<void> {
  await getStatus(db);
  await db.systemStatus.update({ where: { id: 1 }, data });
}

/** FR-09 / NFR-15: record a failed cycle without crashing. */
export async function recordError(db: Db, err: unknown, at: Date): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await updateStatus(db, { lastError: message.slice(0, LAST_ERROR_MAX), lastRunAt: at });
}
