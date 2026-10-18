import { badRequest, route } from "@/lib/api";
import { bearerToken, hashToken } from "@/lib/api-tokens";
import { db } from "@/lib/db";

// Decision "P7 mobile login": revoke the API token this request was made with (204).
export const POST = route({ minRole: "VIEWER" }, async ({ req }) => {
  const token = bearerToken(req);
  if (!token) throw badRequest("logout revokes the bearer token of the request; none was sent");
  await db.apiToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  return new Response(null, { status: 204 });
});
