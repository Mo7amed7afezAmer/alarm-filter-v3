// P7-T07: the server address. The app talks HTTPS to Caddy (`tls internal`, D-06); the phone trusts
// the NOC root certificate once (RUNBOOK "TLS trust"). Clear-text HTTP is refused here and by the
// native config (plugins/with-lan-trust.js); Caddy redirects HTTP to HTTPS anyway.
import { writeServerUrl } from "./storage";

export const UNREACHABLE_HINT = "Check that the phone is on the NOC Wi-Fi and trusts the NOC root certificate (RUNBOOK, TLS trust).";

const CHECK_TIMEOUT_MS = 10_000;

/** User input → `https://host[:port]`; anything else is an error with a message for the screen. */
export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter the server address");
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== "https") throw new Error("Use an https:// address: the NOC server only answers HTTPS (D-06)");
  let url: URL;
  try {
    url = new URL(scheme ? raw : `https://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a server address`);
  }
  if (!url.hostname || /\s/.test(raw)) throw new Error(`"${raw}" is not a server address`);
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "")) {
    throw new Error("Enter only the server address, e.g. https://noc-alarms.lan");
  }
  return url.origin;
}

/** GET /api/health (public, FR-70): 200 and 503 both prove that the NOC server answered. */
export async function checkServer(url: string, fetchFn: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<{ status: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(`${url}/api/health`, { method: "GET", signal: abort.signal });
  } catch {
    throw new Error(`Cannot reach ${url}. ${UNREACHABLE_HINT}`);
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
  if ((res.status !== 200 && res.status !== 503) || typeof body?.status !== "string") {
    throw new Error(`${url} is not the NOC alarm server`);
  }
  return { status: body.status };
}

/** Normalizes, checks and stores the address; nothing is stored when a step fails. */
export async function saveServer(
  input: string,
  fetchFn?: typeof fetch,
  write: (url: string) => Promise<void> = writeServerUrl,
): Promise<string> {
  const url = normalizeServerUrl(input);
  await checkServer(url, fetchFn);
  await write(url);
  return url;
}
