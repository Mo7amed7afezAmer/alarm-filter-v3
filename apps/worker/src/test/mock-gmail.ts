import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GmailApi, GmailHistoryPage, GmailLabel, GmailListPage, GmailMessage } from "../gmail";

/** Test double for the Gmail API, fed from samples/gmail/ (approved 2026-10-15). */
export const samplesDir = fileURLToPath(new URL("../../../../samples", import.meta.url));
const gmailDir = join(samplesDir, "gmail");
const load = <T>(file: string): T => JSON.parse(readFileSync(join(gmailDir, file), "utf8")) as T;

export class GmailHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly reason?: string,
  ) {
    super(`Gmail API ${status}`);
  }
}

export interface MockOptions {
  /** history.list answers 404 (expired history). */
  historyExpired?: boolean;
  /** messages.get throws this status from the n-th call (1-based) onwards. */
  failGetFrom?: { call: number; status: number; reason?: string };
  /** labels.list throws this status. */
  failLabels?: number;
  /** Extra delay for each messages.get, in ms. */
  getDelayMs?: number;
}

export class MockGmail implements GmailApi {
  readonly calls: { method: string; params: unknown }[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private gets = 0;

  constructor(private readonly opts: MockOptions = {}) {}

  async getProfile(): Promise<{ historyId: string }> {
    this.calls.push({ method: "getProfile", params: null });
    return load<{ historyId: string }>("profile.json");
  }

  async labelsList(): Promise<GmailLabel[]> {
    this.calls.push({ method: "labelsList", params: null });
    if (this.opts.failLabels) throw new GmailHttpError(this.opts.failLabels, null);
    return load<{ labels: GmailLabel[] }>("labels-list.json").labels;
  }

  async historyList(params: Parameters<GmailApi["historyList"]>[0]): Promise<GmailHistoryPage> {
    this.calls.push({ method: "historyList", params });
    if (this.opts.historyExpired) throw new GmailHttpError(404, load("history-list-404.json"), "notFound");
    const pages = load<GmailHistoryPage[]>("history-list.json");
    const index = params.pageToken ? Number(params.pageToken.replace("page-", "")) - 1 : 0;
    return pages[index]!;
  }

  async messagesList(params: Parameters<GmailApi["messagesList"]>[0]): Promise<GmailListPage> {
    this.calls.push({ method: "messagesList", params });
    const pages = load<GmailListPage[]>("messages-list.json");
    const index = params.pageToken ? Number(params.pageToken.replace("page-", "")) - 1 : 0;
    return pages[index]!;
  }

  async messagesGet(params: { id: string; format: "full" }): Promise<GmailMessage> {
    this.calls.push({ method: "messagesGet", params });
    const call = ++this.gets;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5 + (this.opts.getDelayMs ?? 0)));
      const fail = this.opts.failGetFrom;
      if (fail && call >= fail.call) throw new GmailHttpError(fail.status, null, fail.reason);
      const file = `message-get-${params.id}.json`;
      if (!existsSync(join(gmailDir, file))) throw new GmailHttpError(404, null, "notFound");
      return load<GmailMessage>(file);
    } finally {
      this.inFlight--;
    }
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

/** Real message records from samples/bodies.jsonl, by Gmail id. */
export function realMessages(): Map<string, { subject: string; receivedAt: string; body: string }> {
  const rows = readFileSync(join(samplesDir, "bodies.jsonl"), "utf8").trim().split("\n");
  return new Map(
    rows.map((l) => {
      const r = JSON.parse(l) as { id: string; subject: string; receivedAt: string; body: string };
      return [r.id, r];
    }),
  );
}

/** Ids in samples/gmail, oldest first by receivedAt. */
export const SAMPLE_IDS = [
  "1a12bc90a4119e8a",
  "1a12bffb0e18dc64",
  "1a12c3637e33cd71",
  "1a12c3698726c4f4",
  "1a12c3856523f17f", // listed, but messages.get answers 404
  "1a12c48bdc085fd2",
];
export const GONE_ID = "1a12c3856523f17f";
export const HTML_ONLY_ID = "1a12bffb0e18dc64";
export const LABEL = { id: "Label_DN", name: "DN" };

/** Office label of the samples (labels-list.json maps it to the id used in history-list.json). */
export const OFFICE = { id: "Label_DN", name: "DN/Kafr ElDawar" };
