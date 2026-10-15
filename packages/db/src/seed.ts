import type { Category, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/** FR-16: the default classification rules, in priority order. */
export const DEFAULT_RULES: { pattern: string; category: Category }[] = [
  { pattern: "LINK FAILURE", category: "DOWN" },
  { pattern: "BTS DOWN", category: "DOWN" },
  { pattern: "CELL UNAVAILABLE", category: "DOWN" },
  { pattern: "SITE DOWN", category: "DOWN" },
  { pattern: "UNREACHABLE", category: "DOWN" },
  { pattern: "NODE DOWN", category: "DOWN" },
  { pattern: "MAINS", category: "POWER" },
  { pattern: "AC FAIL", category: "POWER" },
  { pattern: "BATTERY", category: "POWER" },
  { pattern: "RECTIFIER", category: "POWER" },
  { pattern: "DC LOW", category: "POWER" },
  { pattern: "GENERATOR", category: "POWER" },
  { pattern: "POWER", category: "POWER" },
];

/** NFR-19: bcrypt cost and minimum password length. */
export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 8;

export interface SeedEnv {
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
}

export interface SeedResult {
  rulesSeeded: number;
  adminCreated: boolean;
}

/** FR-16: seed the rules only when the table is empty. */
async function seedRules(db: PrismaClient): Promise<number> {
  if ((await db.rule.count()) > 0) return 0;
  const { count } = await db.rule.createMany({
    data: DEFAULT_RULES.map((r, i) => ({ ...r, priority: (i + 1) * 10 })),
  });
  return count;
}

/** FR-29: create the initial ADMIN once; never overwrite; skip a short password. */
async function seedAdmin(db: PrismaClient, env: SeedEnv): Promise<boolean> {
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password || password.length < MIN_PASSWORD_LENGTH) return false;
  if (await db.user.findUnique({ where: { email } })) return false;
  await db.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), role: "ADMIN" },
  });
  return true;
}

/** Idempotent seed (NFR-31). */
export async function seed(db: PrismaClient, env: SeedEnv): Promise<SeedResult> {
  const rulesSeeded = await seedRules(db);
  const adminCreated = await seedAdmin(db, env);
  return { rulesSeeded, adminCreated };
}
