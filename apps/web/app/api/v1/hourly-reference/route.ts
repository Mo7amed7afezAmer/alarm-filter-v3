import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { ruleSelect, siteSelect } from "@/lib/site-master";

export const dynamic = "force-dynamic";

// G-T14 / G-T15 (decided 2026-10-17): Site Master + normalizations for in-browser processing,
// OPERATOR like …/attachment. ETag = system_status.referenceUpdatedAt; If-None-Match → 304.
export const GET = route({ minRole: "OPERATOR" }, async ({ req }) => {
  const status = await db.systemStatus.findUnique({ where: { id: 1 }, select: { referenceUpdatedAt: true } });
  const updatedAt = (status?.referenceUpdatedAt ?? new Date(0)).toISOString();
  const etag = `"${updatedAt}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
  const [siteMaster, normalizations] = await Promise.all([
    db.siteMaster.findMany({ select: siteSelect, orderBy: { code: "asc" } }),
    db.hourlyNormalization.findMany({ select: ruleSelect, orderBy: { id: "asc" } }),
  ]);
  return Response.json({ updatedAt, siteMaster, normalizations }, { headers });
});
