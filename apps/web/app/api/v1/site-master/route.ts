import { baseNormalize } from "@alarm/core";
import type { Prisma } from "@alarm/db";
import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { pagination } from "@/lib/params";
import { siteSelect } from "@/lib/site-master";

export const dynamic = "force-dynamic";

const query = z.object({
  office: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  ...pagination,
});

// FR-67: any signed-in user lists Site Master rows by code (filter office, q = code or site name).
export const GET = route({ minRole: "VIEWER", query }, async ({ query: { office, q, page, pageSize } }) => {
  const text = q?.trim();
  const where: Prisma.SiteMasterWhereInput = {
    ...(office?.trim() ? { office: baseNormalize(office) } : {}),
    ...(text
      ? { OR: [{ code: { contains: text, mode: "insensitive" } }, { siteName: { contains: text, mode: "insensitive" } }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    db.siteMaster.count({ where }),
    db.siteMaster.findMany({ where, select: siteSelect, orderBy: { code: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, items };
});
