import { parseSiteMaster } from "@alarm/core";
import * as XLSX from "xlsx";
import { ApiError, badRequest, route } from "@/lib/api";
import { db } from "@/lib/db";
import { MAX_IMPORT_BYTES, touchReference } from "@/lib/site-master";

export const dynamic = "force-dynamic";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// FR-65: ADMIN imports a Site Master .xlsx (≤ 5 MB, NFR-25) as multipart field `file` and upserts
// by Code; returns inserted / updated / skipped.
export const POST = route({ minRole: "ADMIN", idempotent: true }, async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw badRequest("multipart field `file` is required");
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError(413, "TOO_LARGE", "the Site Master file is limited to 5 MB");
  const name = file instanceof File ? file.name : "";
  if (!name.toLowerCase().endsWith(".xlsx")) throw badRequest("the Site Master must be an .xlsx file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw badRequest("the file is not an .xlsx workbook");

  let sheets: Record<string, Record<string, unknown>[]>;
  try {
    const book = XLSX.read(bytes, { type: "array", dense: true, cellHTML: false, cellStyles: false });
    sheets = Object.fromEntries(
      book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[n]!, { raw: true, defval: "" })]),
    );
  } catch {
    throw badRequest("the workbook could not be read");
  }
  const { records, skipped } = parseSiteMaster(sheets);

  const existing = new Set(
    (await db.siteMaster.findMany({ where: { code: { in: records.map((r) => r.code) } }, select: { code: true } })).map((r) => r.code),
  );
  await db.$transaction(
    async (tx) => {
      for (const { code, ...r } of records) {
        const data = {
          siteName: r.siteName ?? null,
          office: r.office!,
          nodality: r.nodality,
          vip: r.vip,
          siteType: r.siteType,
          powerSource: r.powerSource,
          battery: r.battery,
          phone: r.phone,
          region: r.region ?? null,
          notes: r.notes ?? null,
        };
        await tx.siteMaster.upsert({ where: { code }, create: { code, ...data }, update: data });
      }
      await touchReference(tx);
    },
    { timeout: 5 * 60_000, maxWait: 60_000 },
  );
  return { inserted: records.length - existing.size, updated: existing.size, skipped };
});
