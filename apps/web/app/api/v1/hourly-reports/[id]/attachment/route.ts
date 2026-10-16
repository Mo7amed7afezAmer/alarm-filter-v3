import { z } from "zod";
import { route } from "@/lib/api";
import { contentDisposition, downloadChecked, REPORT_ID, reportFile, streamBytes } from "@/lib/hourly-files";

// Reads Gmail on every request.
export const dynamic = "force-dynamic";

const CONTENT_TYPE = { rar: "application/vnd.rar", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", other: "application/octet-stream" };

// D-10: the browser processes the report; the server streams the checked attachment
// (FR-48, FR-50, FR-52). OPERATOR, as processing was (FR-49, decided 2026-10-17).
export const GET = route({ minRole: "OPERATOR", params: z.object({ id: z.string().regex(REPORT_ID) }) }, async ({ params }) => {
  const attachment = await reportFile(params.id);
  const bytes = await downloadChecked(params.id, attachment);
  return streamBytes(bytes, {
    "Content-Type": CONTENT_TYPE[attachment.kind],
    "Content-Disposition": contentDisposition(attachment.filename),
  });
});
