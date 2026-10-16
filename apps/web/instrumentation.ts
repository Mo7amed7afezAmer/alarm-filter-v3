// Runs once when the server starts: refuse to boot without NEXTAUTH_SECRET.
export async function register(): Promise<void> {
  const { assertAuthEnv } = await import("./lib/auth");
  assertAuthEnv(process.env);
}
