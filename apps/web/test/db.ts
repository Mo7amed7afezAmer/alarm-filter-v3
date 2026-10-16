import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@alarm/db";

/** Integration tests run only against alarms_test (NFR-41); vitest.config points DATABASE_URL there. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));

export async function freshDatabase(): Promise<PrismaClient> {
  const url = testDatabaseUrl!;
  if (new URL(url).pathname !== "/alarms_test") throw new Error("TEST_DATABASE_URL must point at alarms_test");
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  execSync("pnpm exec prisma migrate deploy", { cwd: dbPackage, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return db;
}

export async function clearUsers(db: PrismaClient): Promise<void> {
  await db.user.deleteMany();
}

export type Role = "VIEWER" | "OPERATOR" | "ADMIN";

export async function createUser(db: PrismaClient, email: string, role: Role, password = "password-123") {
  // Low cost keeps tests fast; production hashing uses 12 rounds (NFR-19).
  return db.user.create({ data: { email, role, passwordHash: await bcrypt.hash(password, 4) } });
}

export function jsonRequest(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
