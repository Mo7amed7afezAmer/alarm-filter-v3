// FR-25: NextAuth credentials — case-insensitive e-mail, bcrypt comparison, JWT session of 12 h
// carrying id and role (NFR-20). D-08: per-e-mail lockout. Explicit secret, required at boot.
import type { PrismaClient } from "@alarm/db";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";
import { loginLockout, type LoginLockout } from "./lockout";
import type { Role } from "./roles";

export const SESSION_MAX_AGE_SEC = 12 * 3600;

export { assertAuthEnv } from "./auth-env";

export interface AuthorizeDeps {
  db: PrismaClient;
  lockout: LoginLockout;
  now?: () => number;
}

export async function authorizeCredentials(
  credentials: { email?: string; password?: string } | undefined,
  deps: AuthorizeDeps,
): Promise<{ id: string; email: string; role: Role } | null> {
  const email = credentials?.email?.trim() ?? "";
  const password = credentials?.password ?? "";
  if (!email || !password) return null;
  const now = (deps.now ?? Date.now)();
  if (deps.lockout.isLocked(email, now)) return null;

  const user = await deps.db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    deps.lockout.fail(email, now);
    return null;
  }
  deps.lockout.succeed(email);
  return { id: String(user.id), email: user.email, role: user.role };
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC },
  jwt: { maxAge: SESSION_MAX_AGE_SEC },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: { email: { label: "E-mail", type: "email" }, password: { label: "Password", type: "password" } },
      authorize: (credentials) => authorizeCredentials(credentials, { db, lockout: loginLockout }),
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { id: string; role: Role };
        token.id = Number(u.id);
        token.role = u.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = { ...session.user, id: token.id as number, role: token.role as Role } as typeof session.user;
      return session;
    },
  },
};
