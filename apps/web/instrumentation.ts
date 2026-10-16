import { assertAuthEnv } from "./lib/auth-env";

// Runs once when the server starts: refuse to boot without NEXTAUTH_SECRET.
export function register(): void {
  assertAuthEnv(process.env);
}
