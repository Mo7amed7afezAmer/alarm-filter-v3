// `pnpm gmail:auth` — one-time Gmail authorisation. Prints the consent URL, receives the code on a
// local loopback port (or accepts it pasted), and writes token.json to GOOGLE_TOKEN_PATH.
// Never prints the client secret or any token.
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AddressInfo } from "node:net";
import { GMAIL_SCOPES, GmailSetupError, oauthClient, readDesktopClient } from "./client";

// pnpm runs this in apps/worker; resolve relative paths and .env from where the command was typed.
const baseDir = process.env.INIT_CWD ?? process.cwd();
const envFile = resolve(baseDir, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function pathFrom(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new GmailSetupError(`${name} is required (see .env.example).`);
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

/** Accepts a bare code or the full redirected URL. */
function codeFrom(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return new URL(text).searchParams.get("code");
  } catch {
    return text;
  }
}

async function main(): Promise<void> {
  const credentialsPath = pathFrom("GOOGLE_CREDENTIALS_PATH");
  const tokenPath = pathFrom("GOOGLE_TOKEN_PATH");
  const client = await readDesktopClient(credentialsPath);

  let deliver: (code: string) => void = () => {};
  const received = new Promise<string>((r) => (deliver = r));

  const server = createServer((req, res) => {
    const code = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("code");
    res.writeHead(code ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(code ? "Gmail access authorised. You can close this tab." : "No authorisation code in this request.");
    if (code) deliver(code);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const auth = oauthClient(client, redirectUri);
  const url = auth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GMAIL_SCOPES });

  console.log("\n1. Open this URL in a browser and sign in with the NOC mailbox account:\n");
  console.log(`   ${url}\n`);
  console.log(`2. After you allow access, the browser is sent to ${redirectUri} and this script continues.`);
  console.log("   If that page does not load, copy the full address from the browser bar and paste it here.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    const code = codeFrom(line);
    if (code) deliver(code);
  });

  try {
    const code = await received;
    const { tokens } = await auth.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
      throw new GmailSetupError(
        "Google returned no refresh token. Remove this app's access at https://myaccount.google.com/permissions and run again.",
      );
    }
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o600 });
    console.log(`\nSaved ${tokenPath} (scope: ${tokens.scope ?? GMAIL_SCOPES.join(" ")}).`);
  } finally {
    rl.close();
    server.close();
  }
}

main().catch((err: unknown) => {
  console.error(`\ngmail:auth failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
