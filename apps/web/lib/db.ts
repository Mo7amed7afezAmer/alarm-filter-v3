import { PrismaClient } from "@alarm/db";

// One client per server process (single web replica, D-04).
const globalForDb = globalThis as unknown as { alarmDb?: PrismaClient };

export const db: PrismaClient = globalForDb.alarmDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForDb.alarmDb = db;
