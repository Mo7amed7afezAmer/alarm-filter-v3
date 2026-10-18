// Hourly reports from Gmail (FR-47, FR-48): list messages of HOURLY_GMAIL_LABEL that have an
// attachment, and fetch one attachment. D-10: the server only lists and streams; nothing is cached
// or written to disk. HOURLY_GMAIL_MOCK_DIR (dev/test) serves local files instead of Gmail.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { attachmentKind, type AttachmentKind } from "@alarm/core";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client, type Credentials } from "google-auth-library";

export interface HourlyPart {
  partId?: string;
  mimeType?: string;
  filename: string;
  body?: { size?: number; attachmentId?: string; data?: string };
  parts?: HourlyPart[];
}

export interface HourlyMessage {
  id: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[]; parts?: HourlyPart[] } & Partial<HourlyPart>;
}

export interface HourlyListPage {
  messages?: { id: string }[];
  nextPageToken?: string | null;
}

/** The Gmail calls this module makes. */
export interface HourlyApi {
  messagesList(params: { q: string; maxResults: number; pageToken?: string }): Promise<HourlyListPage>;
  messagesGet(params: { id: string; format: "full" }): Promise<HourlyMessage>;
  attachmentsGet(params: { messageId: string; id: string }): Promise<{ data: string; size: number }>;
}

export interface ReportAttachment {
  filename: string;
  size: number;
  kind: AttachmentKind;
  attachmentId: string;
}

export interface ReportSummary {
  id: string;
  subject: string;
  receivedAt: string;
  attachment: Omit<ReportAttachment, "attachmentId"> | null;
}

/** FR-47: 25 reports per page. */
export const PAGE_SIZE = 25;

export function hourlyLabel(): string {
  return process.env.HOURLY_GMAIL_LABEL?.trim() || "Hourly Update";
}

function attachmentsOf(parts: HourlyPart[] | undefined, out: ReportAttachment[] = []): ReportAttachment[] {
  for (const p of parts ?? []) {
    if (p.filename && p.body?.attachmentId) {
      out.push({ filename: p.filename, size: p.body.size ?? 0, kind: attachmentKind(p.filename), attachmentId: p.body.attachmentId });
    }
    attachmentsOf(p.parts, out);
  }
  return out;
}

/** FR-48: the first .rar, else the first .xlsx, else the first attachment. */
export function reportAttachment(message: HourlyMessage): ReportAttachment | null {
  const all = attachmentsOf(message.payload?.parts);
  return all.find((a) => a.kind === "rar") ?? all.find((a) => a.kind === "xlsx") ?? all[0] ?? null;
}

export function summarize(message: HourlyMessage): ReportSummary {
  const subject = message.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  const a = reportAttachment(message);
  return {
    id: message.id,
    subject,
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    attachment: a ? { filename: a.filename, size: a.size, kind: a.kind } : null,
  };
}

/** FR-47: one page of reports, without downloading attachments. */
export async function listReports(api: HourlyApi, pageToken?: string) {
  const page = await api.messagesList({ q: `label:"${hourlyLabel()}" has:attachment`, maxResults: PAGE_SIZE, pageToken });
  const messages = await Promise.all((page.messages ?? []).map((m) => api.messagesGet({ id: m.id, format: "full" })));
  return { reports: messages.map(summarize), nextPageToken: page.nextPageToken ?? null };
}

// ---------------------------------------------------------------- real Gmail and the mock dir

function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) throw new Error(`${what} not found at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function gmailFromFiles(credentialsPath: string, tokenPath: string): HourlyApi {
  const creds = readJson<{ installed?: { client_id?: string; client_secret?: string } }>(
    credentialsPath,
    "Gmail OAuth client file (GOOGLE_CREDENTIALS_PATH)",
  );
  if (!creds.installed?.client_id || !creds.installed.client_secret)
    throw new Error("GOOGLE_CREDENTIALS_PATH is not a Desktop OAuth client");
  const auth = new OAuth2Client({ clientId: creds.installed.client_id, clientSecret: creds.installed.client_secret });
  // Access tokens refresh in memory; token.json is mounted read-only (NFR-21).
  auth.setCredentials(readJson<Credentials>(tokenPath, "Gmail token file (GOOGLE_TOKEN_PATH)"));
  const api = gmailApi({ version: "v1", auth: auth as unknown as Parameters<typeof gmailApi>[0]["auth"] });
  const userId = "me";
  return {
    async messagesList(params) {
      return (await api.users.messages.list({ userId, ...params })).data as HourlyListPage;
    },
    async messagesGet(params) {
      return (await api.users.messages.get({ userId, ...params })).data as HourlyMessage;
    },
    async attachmentsGet({ messageId, id }) {
      const { data } = await api.users.messages.attachments.get({ userId, messageId, id });
      return { data: data.data ?? "", size: data.size ?? 0 };
    },
  };
}

class NotFound extends Error {
  readonly status = 404;
}

/** HOURLY_GMAIL_MOCK_DIR: each .rar / .xlsx file in the directory is one report. */
function mockDirApi(dir: string): HourlyApi {
  const files = () =>
    readdirSync(dir)
      .filter((f) => attachmentKind(f) !== "other")
      .sort();
  const idOf = (f: string) => `mock-${f.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
  const fileOf = (id: string) => files().find((f) => idOf(f) === id);
  return {
    async messagesList() {
      return { messages: files().map((f) => ({ id: idOf(f) })), nextPageToken: null };
    },
    async messagesGet({ id }) {
      const f = fileOf(id);
      if (!f) throw new NotFound(id);
      const st = statSync(join(dir, f));
      return {
        id,
        internalDate: String(st.mtimeMs | 0),
        payload: {
          headers: [{ name: "Subject", value: `Mock report ${f}` }],
          parts: [{ filename: f, body: { size: st.size, attachmentId: f } }],
        },
      };
    },
    async attachmentsGet({ id }) {
      const bytes = readFileSync(join(dir, id));
      return { data: bytes.toString("base64url"), size: bytes.length };
    },
  };
}

let cached: HourlyApi | null = null;

export function getHourlyApi(): HourlyApi {
  if (cached) return cached;
  const mock = process.env.HOURLY_GMAIL_MOCK_DIR?.trim();
  if (mock) return (cached = mockDirApi(mock));
  const credentials = process.env.GOOGLE_CREDENTIALS_PATH?.trim();
  const token = process.env.GOOGLE_TOKEN_PATH?.trim();
  if (!credentials || !token) throw new Error("GOOGLE_CREDENTIALS_PATH and GOOGLE_TOKEN_PATH are required");
  return (cached = gmailFromFiles(credentials, token));
}

export function isNotFound(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  return e?.status === 404 || e?.code === 404 || e?.response?.status === 404;
}
