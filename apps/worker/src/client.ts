// Real Gmail binding: OAuth2 Desktop client from credentials.json + token.json (NFR-21).
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client, type Credentials } from "google-auth-library";
import type { GmailApi } from "./gmail";

/** NFR-21: read-only access. */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/** A setup problem the operator must fix (missing or wrong OAuth files). */
export class GmailSetupError extends Error {}

export interface DesktopClient {
  clientId: string;
  clientSecret: string;
}

/** Reads the OAuth client file; it must be a "Desktop app" client (`installed`). */
export async function readDesktopClient(credentialsPath: string): Promise<DesktopClient> {
  if (!existsSync(credentialsPath)) {
    throw new GmailSetupError(
      `Gmail OAuth client file not found at ${credentialsPath} (GOOGLE_CREDENTIALS_PATH). ` +
        `Create an OAuth client of type "Desktop app" for the Gmail API in Google Cloud Console and save it there.`,
    );
  }
  let parsed: { installed?: { client_id?: string; client_secret?: string } };
  try {
    parsed = JSON.parse(await readFile(credentialsPath, "utf8")) as typeof parsed;
  } catch {
    throw new GmailSetupError(`Gmail OAuth client file at ${credentialsPath} is not valid JSON.`);
  }
  const installed = parsed.installed;
  if (!installed?.client_id || !installed.client_secret) {
    throw new GmailSetupError(`Gmail OAuth client file at ${credentialsPath} is not a "Desktop app" client (no "installed" section).`);
  }
  return { clientId: installed.client_id, clientSecret: installed.client_secret };
}

export function oauthClient(client: DesktopClient, redirectUri?: string): OAuth2Client {
  return new OAuth2Client({ clientId: client.clientId, clientSecret: client.clientSecret, redirectUri });
}

async function readToken(tokenPath: string): Promise<Credentials> {
  if (!existsSync(tokenPath)) {
    throw new GmailSetupError(`Gmail token file not found at ${tokenPath} (GOOGLE_TOKEN_PATH). Run "pnpm gmail:auth" once to create it.`);
  }
  try {
    return JSON.parse(await readFile(tokenPath, "utf8")) as Credentials;
  } catch {
    throw new GmailSetupError(`Gmail token file at ${tokenPath} is not valid JSON. Run "pnpm gmail:auth" again.`);
  }
}

/**
 * Builds the Gmail client. Access tokens are refreshed in memory from the stored refresh token;
 * token.json is never rewritten because it is mounted read-only (NFR-21).
 */
export async function createGmailApi(paths: { credentialsPath: string; tokenPath: string }): Promise<GmailApi> {
  const client = await readDesktopClient(paths.credentialsPath);
  const token = await readToken(paths.tokenPath);
  if (!token.refresh_token) {
    throw new GmailSetupError(`Gmail token file at ${paths.tokenPath} has no refresh token. Run "pnpm gmail:auth" again.`);
  }
  const auth = oauthClient(client);
  auth.setCredentials(token);
  const api = gmailApi({ version: "v1", auth: auth as unknown as Parameters<typeof gmailApi>[0]["auth"] });
  const userId = "me";

  return {
    async labelsList() {
      const { data } = await api.users.labels.list({ userId });
      return (data.labels ?? []).map((l) => ({ id: l.id ?? "", name: l.name ?? "", type: l.type ?? undefined }));
    },
    async getProfile() {
      const { data } = await api.users.getProfile({ userId });
      return { historyId: data.historyId ?? null };
    },
    async historyList(params) {
      const { data } = await api.users.history.list({ userId, ...params });
      return data as Awaited<ReturnType<GmailApi["historyList"]>>;
    },
    async messagesList(params) {
      const { data } = await api.users.messages.list({ userId, ...params });
      return data as Awaited<ReturnType<GmailApi["messagesList"]>>;
    },
    async messagesGet(params) {
      const { data } = await api.users.messages.get({ userId, ...params });
      return data as Awaited<ReturnType<GmailApi["messagesGet"]>>;
    },
  };
}
