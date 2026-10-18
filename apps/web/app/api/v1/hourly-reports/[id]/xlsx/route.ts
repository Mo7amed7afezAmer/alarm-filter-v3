import { extractXlsxFromRar } from "@alarm/core";
import { z } from "zod";
import { route } from "@/lib/api";
import {
  asApiError,
  contentDisposition,
  downloadChecked,
  hourlyLimits,
  REPORT_ID,
  reportFile,
  streamBytes,
  unrarWasm,
} from "@/lib/hourly-files";

// Reads Gmail on every request.
export const dynamic = "force-dynamic";

// D-11: for the mobile app the server unrars the report and streams the workbook. FR-51 checks
// run on the RAR headers and the extraction happens in memory (no temp files, decided 2026-10-17).
export const GET = route({ minRole: "OPERATOR", params: z.object({ id: z.string().regex(REPORT_ID) }) }, async ({ params }) => {
  const attachment = await reportFile(params.id);
  const bytes = await downloadChecked(params.id, attachment);
  let workbook = { name: attachment.filename, data: bytes };
  if (attachment.kind === "rar") {
    try {
      workbook = await extractXlsxFromRar(bytes, hourlyLimits(), unrarWasm());
    } catch (err) {
      throw asApiError(err);
    }
  }
  return streamBytes(workbook.data, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": contentDisposition(workbook.name),
  });
});
