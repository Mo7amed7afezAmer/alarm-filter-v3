import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HourlyApi, HourlyListPage, HourlyMessage } from "@/lib/gmail-hourly";

// Test double for the Gmail API, fed from samples/gmail/hourly/; an attachmentId names a file in
// samples/hourly/, served as Gmail does (base64url).
const gmailDir = fileURLToPath(new URL("../../../samples/gmail/hourly/", import.meta.url));
export const hourlyDir = fileURLToPath(new URL("../../../samples/hourly/", import.meta.url));
const load = <T>(file: string): T => JSON.parse(readFileSync(gmailDir + file, "utf8")) as T;

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API ${status}`);
  }
}

export const REAL_ID = "1a12b49a56ded6dd";
export const XLSX_ID = "hourlyxlsx000001";
export const NO_ATTACHMENT_ID = "hourlynoatt00001";
export const BIG_ID = "hourlybig0000001";

export class MockHourlyApi implements HourlyApi {
  readonly calls: { method: string; params: unknown }[] = [];
  /** Replaces the bytes of an attachment id. */
  readonly override = new Map<string, Uint8Array>();

  async messagesList(params: { q: string; maxResults: number; pageToken?: string }): Promise<HourlyListPage> {
    this.calls.push({ method: "messagesList", params });
    const pages = load<HourlyListPage[]>("messages-list.json");
    return pages[params.pageToken ? Number(params.pageToken.replace("page-", "")) - 1 : 0]!;
  }

  async messagesGet(params: { id: string; format: "full" }): Promise<HourlyMessage> {
    this.calls.push({ method: "messagesGet", params });
    const file = `message-get-${params.id}.json`;
    if (!existsSync(gmailDir + file)) throw new HttpError(404);
    return load<HourlyMessage>(file);
  }

  async attachmentsGet(params: { messageId: string; id: string }): Promise<{ data: string; size: number }> {
    this.calls.push({ method: "attachmentsGet", params });
    const bytes = this.override.get(params.id) ?? new Uint8Array(readFileSync(hourlyDir + params.id));
    return { data: Buffer.from(bytes).toString("base64url"), size: bytes.length };
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}
