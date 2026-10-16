import { z } from "zod";
import { route } from "@/lib/api";
import { getHourlyApi, listReports } from "@/lib/gmail-hourly";

// Reads Gmail on every request.
export const dynamic = "force-dynamic";

// FR-47: Gmail messages of HOURLY_GMAIL_LABEL with an attachment, 25 per page (Gmail page token),
// without downloading attachments. No server cache (D-10).
const query = z.object({ pageToken: z.string().trim().min(1).max(200).optional() });

export const GET = route({ minRole: "VIEWER", query }, async ({ query }) => listReports(getHourlyApi(), query.pageToken));
