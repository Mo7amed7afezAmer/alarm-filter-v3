// P3-T07: API tokens for scripts and the mobile app. A token is 32 random bytes (base64url), shown
// once at creation; only its SHA-256 hash is stored. It acts as its user with that user's current
// role until revoked (decided 2026-10-18: chosen user, no expiry, revoke only).
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@alarm/db";
import type { SessionUser } from "./roles";

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const newToken = (): string => randomBytes(32).toString("base64url");

/** The bearer token of an `Authorization: Bearer …` header, or null when there is none. */
export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]!.trim() : null;
}

/** The user a token acts as, or null when the token is unknown or revoked. */
export async function tokenUser(db: PrismaClient, token: string): Promise<SessionUser | null> {
  const row = await db.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { revokedAt: true, user: { select: { id: true, email: true, role: true } } },
  });
  if (!row || row.revokedAt) return null;
  return row.user;
}
