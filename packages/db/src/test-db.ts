import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

/** Integration tests run only against `alarms_test` (NFR-41). */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function assertTestDatabase(url: string): void {
  if (new URL(url).pathname !== "/alarms_test") {
    throw new Error("TEST_DATABASE_URL must point at the alarms_test database");
  }
}

export function testClient(url: string): PrismaClient {
  assertTestDatabase(url);
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Drops every table so the next migration runs on a fresh database. */
export async function resetSchema(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
}

export function migrateDeploy(url: string): string {
  assertTestDatabase(url);
  return execSync("pnpm exec prisma migrate deploy", {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
}

export async function freshDatabase(url: string): Promise<PrismaClient> {
  const db = testClient(url);
  await resetSchema(db);
  migrateDeploy(url);
  return db;
}

/** Empties every table, keeping the migrated schema (DELETE is much faster than TRUNCATE on tiny tables). */
export async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$transaction([
    db.orphanClear.deleteMany(),
    db.rawMessage.deleteMany(),
    db.alarm.deleteMany(),
    db.rule.deleteMany(),
    db.site.deleteMany(),
    db.user.deleteMany(),
    db.systemStatus.deleteMany(),
    db.siteMaster.deleteMany(),
    db.hourlyNormalization.deleteMany(),
  ]);
}
