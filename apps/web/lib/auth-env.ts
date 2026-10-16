/** NEXTAUTH_SECRET must be set before the web app serves anything (FR-25). */
export function assertAuthEnv(env: Record<string, string | undefined>): void {
  if (!env.NEXTAUTH_SECRET?.trim()) throw new Error("NEXTAUTH_SECRET is required");
}
