// Gmail reads used by the worker (FR-02, FR-03, FR-06). `GmailApi` is the subset of the Gmail API
// the worker calls; `client.ts` binds it to the real API and tests bind it to samples/gmail/.

export interface GmailRef {
  id: string;
  threadId?: string;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: { message: GmailRef }[];
  labelsAdded?: { message: GmailRef; labelIds: string[] }[];
}

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

export interface GmailListPage {
  messages?: GmailRef[];
  nextPageToken?: string;
}

export interface GmailPayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string };
  parts?: GmailPayload[];
}

export interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPayload;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface GmailApi {
  labelsList(): Promise<GmailLabel[]>;
  getProfile(): Promise<{ historyId?: string | null }>;
  historyList(params: {
    startHistoryId: string;
    labelId: string;
    historyTypes: string[];
    maxResults: number;
    pageToken?: string;
  }): Promise<GmailHistoryPage>;
  messagesList(params: { q: string; maxResults: number; pageToken?: string }): Promise<GmailListPage>;
  messagesGet(params: { id: string; format: "full" }): Promise<GmailMessage>;
}

// ---------------------------------------------------------------- errors

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const v of [e?.status, e?.response?.status, e?.code]) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d{3}$/.test(v)) return Number(v);
  }
  return undefined;
}

function reasonsOf(err: unknown): string[] {
  const e = err as { reason?: unknown; errors?: { reason?: unknown }[]; response?: { data?: { error?: { errors?: { reason?: unknown }[] } } } };
  const list = [e?.reason, ...(e?.errors ?? []).map((x) => x.reason), ...(e?.response?.data?.error?.errors ?? []).map((x) => x.reason)];
  return list.filter((r): r is string => typeof r === "string");
}

export function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

/** FR-06: 429, or 403 for quota / rate limits. */
export function isQuotaError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429) return true;
  if (status !== 403) return false;
  const text = [...reasonsOf(err), String((err as Error)?.message ?? "")].join(" ");
  return /quota|rate/i.test(text);
}

// ---------------------------------------------------------------- discovery

const EXCLUDED = new Set(["DRAFT", "SENT"]);
const excluded = (m: GmailRef) => (m.labelIds ?? []).some((l) => EXCLUDED.has(l));

/**
 * FR-02: message ids added to the label since `startHistoryId`, oldest first, and the newest
 * historyId; `"expired"` when Gmail answers 404.
 */
export async function historySince(
  gmail: GmailApi,
  startHistoryId: string,
  labelId: string,
): Promise<{ ids: string[]; historyId: string } | "expired"> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (m: GmailRef) => {
    if (excluded(m) || seen.has(m.id)) return;
    seen.add(m.id);
    ids.push(m.id);
  };
  let historyId = startHistoryId;
  let pageToken: string | undefined;
  try {
    do {
      const page = await gmail.historyList({
        startHistoryId,
        labelId,
        historyTypes: ["messageAdded", "labelAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const record of page.history ?? []) {
        for (const { message } of record.messagesAdded ?? []) add(message);
        for (const { message, labelIds } of record.labelsAdded ?? []) {
          if (labelIds.includes(labelId)) add(message);
        }
      }
      if (page.historyId && BigInt(page.historyId) > BigInt(historyId)) historyId = page.historyId;
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    if (isNotFound(err)) return "expired";
    throw err;
  }
  return { ids, historyId };
}

/** FR-03: the mailbox's current historyId, captured before a fallback listing. */
export async function currentHistoryId(gmail: GmailApi): Promise<string> {
  const { historyId } = await gmail.getProfile();
  if (!historyId) throw new Error("Gmail profile has no historyId");
  return historyId;
}

/** FR-03: `after:<epoch> (label:…) <GMAIL_QUERY>`; ids oldest first. */
export async function listSince(
  gmail: GmailApi,
  opts: { after: Date; labelName: string; query: string },
): Promise<string[]> {
  const q = [`after:${Math.floor(opts.after.getTime() / 1000)}`, `(label:"${opts.labelName}")`, opts.query]
    .filter(Boolean)
    .join(" ");
  const newestFirst: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail.messagesList({ q, maxResults: 500, pageToken });
    for (const m of page.messages ?? []) newestFirst.push(m.id);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return [...new Set(newestFirst)].reverse();
}

// ---------------------------------------------------------------- messages

/** FR-06: stored body length limit. */
export const BODY_MAX_CHARS = 20_000;

function decode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function findPart(payload: GmailPayload, mimeType: string): GmailPayload | null {
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function stripHtml(markup: string): string {
  return markup
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[ent.toLowerCase()] ?? whole;
    });
}

/** FR-06: text/plain preferred, else HTML with tags stripped; at most 20,000 characters. */
export function extractText(payload: GmailPayload): string | null {
  const plain = findPart(payload, "text/plain");
  if (plain) return decode(plain.body!.data!).slice(0, BODY_MAX_CHARS);
  const html = findPart(payload, "text/html");
  if (html) return stripHtml(decode(html.body!.data!)).slice(0, BODY_MAX_CHARS);
  return null;
}

export interface FetchedMessage {
  gmailId: string;
  subject: string;
  receivedAt: Date;
  body: string | null;
}

/** FR-06: `messages.get format:"full"`; null when the message is gone (404). */
export async function getMessage(gmail: GmailApi, id: string): Promise<FetchedMessage | null> {
  let msg: GmailMessage;
  try {
    msg = await gmail.messagesGet({ id, format: "full" });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const payload = msg.payload ?? {};
  const subject = payload.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  return {
    gmailId: msg.id,
    subject,
    receivedAt: new Date(Number(msg.internalDate)),
    body: extractText(payload),
  };
}
