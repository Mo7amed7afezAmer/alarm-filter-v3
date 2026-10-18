import { errorResponse } from "@/lib/api";
import { issueToken, loginBody } from "@/lib/api-tokens";
import { authorizeCredentials } from "@/lib/auth";
import { db } from "@/lib/db";
import { loginLockout } from "@/lib/lockout";

// Decision "P7 mobile login": public. The same check as the web sign-in (FR-25: case-insensitive
// e-mail, bcrypt; D-08: 5 failures lock the e-mail for 15 min, and Caddy limits 10/min/IP); a
// success returns a new API token of that user (P3-T07), named "mobile".
export async function POST(req: Request): Promise<Response> {
  try {
    const raw: unknown = await req.json().catch(() => undefined);
    const parsed = loginBody.safeParse(raw);
    if (!parsed.success) return errorResponse(400, "BAD_REQUEST", "invalid body", parsed.error.flatten());
    const user = await authorizeCredentials(parsed.data, { db, lockout: loginLockout });
    if (!user) return errorResponse(401, "UNAUTHORIZED", "wrong e-mail or password");
    const token = await issueToken(db, Number(user.id), "mobile");
    return Response.json({ token, user: { id: Number(user.id), email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    return errorResponse(500, "INTERNAL", "internal server error");
  }
}
