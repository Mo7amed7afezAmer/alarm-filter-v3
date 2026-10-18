import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGmailApi, GMAIL_SCOPES, GmailSetupError } from "./client";
import { loadGmailConfig } from "./config";

const dir = mkdtempSync(join(tmpdir(), "gmail-client-"));
const missing = join(dir, "missing.json");

describe("createGmailApi: start-up errors", () => {
  it("fails clearly when the credentials file is missing", async () => {
    const err = await createGmailApi({ credentialsPath: missing, tokenPath: missing }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailSetupError);
    expect(String((err as Error).message)).toContain(missing);
    expect(String((err as Error).message)).toContain("GOOGLE_CREDENTIALS_PATH");
  });

  it("fails clearly when the credentials file is not a Desktop OAuth client", async () => {
    const bad = join(dir, "bad-credentials.json");
    writeFileSync(bad, JSON.stringify({ type: "service_account" }));
    const err = await createGmailApi({ credentialsPath: bad, tokenPath: missing }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailSetupError);
    expect(String((err as Error).message)).toMatch(/Desktop/i);
  });

  it("fails clearly when token.json is missing and points at pnpm gmail:auth", async () => {
    const creds = join(dir, "credentials.json");
    writeFileSync(creds, JSON.stringify({ installed: { client_id: "id", client_secret: "secret", redirect_uris: ["http://localhost"] } }));
    const err = await createGmailApi({ credentialsPath: creds, tokenPath: missing }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailSetupError);
    expect(String((err as Error).message)).toContain("pnpm gmail:auth");
  });

  it("asks for gmail.readonly only (NFR-21)", () => {
    expect(GMAIL_SCOPES).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

describe("loadGmailConfig (NFR-34)", () => {
  const base = { GOOGLE_CREDENTIALS_PATH: "c.json", GOOGLE_TOKEN_PATH: "t.json" };

  it("reads paths and defaults", () => {
    expect(loadGmailConfig(base)).toEqual({
      credentialsPath: "c.json",
      tokenPath: "t.json",
      initialBackfillHours: 24,
      maxMessagesPerRun: 200,
      gmailQuery: "",
    });
  });

  it("reads overrides", () => {
    expect(loadGmailConfig({ ...base, INITIAL_BACKFILL_HOURS: "48", MAX_MESSAGES_PER_RUN: "50", GMAIL_QUERY: "from:x" })).toMatchObject({
      initialBackfillHours: 48,
      maxMessagesPerRun: 50,
      gmailQuery: "from:x",
    });
  });

  it.each(["GOOGLE_CREDENTIALS_PATH", "GOOGLE_TOKEN_PATH"])("requires %s", (name) => {
    expect(() => loadGmailConfig({ ...base, [name]: "" })).toThrow(name);
  });

  it.each(["abc", "1.5", "-1"])("rejects a non-integer INITIAL_BACKFILL_HOURS=%s", (value) => {
    expect(() => loadGmailConfig({ ...base, INITIAL_BACKFILL_HOURS: value })).toThrow("INITIAL_BACKFILL_HOURS");
  });
});
