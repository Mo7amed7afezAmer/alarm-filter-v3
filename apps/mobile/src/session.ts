// P7-T02: sign-in with POST /api/v1/auth/login (decision "P7 mobile login"), the stored session,
// sign-out (server revoke + local delete) and automatic sign-out on 401.
import { deleteSession, readServerUrl, readSession, writeSession, type Session } from "./storage";

export interface SessionDeps {
  fetch?: typeof fetch;
  serverUrl?: () => Promise<string | null>;
  /** Called after every sign-out (logout or 401): go to the login screen, drop in-memory reports. */
  onSignedOut?: () => void;
}

type Listener = (s: Session | null) => void;

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `request failed (${res.status})`;
}

export class SessionStore {
  current: Session | null = null;
  readonly fetch: typeof fetch;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: SessionDeps = {}) {
    this.fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
  }

  async baseUrl(): Promise<string> {
    const url = await (this.deps.serverUrl ?? readServerUrl)();
    if (!url) throw new Error("no server address set");
    return url;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: Session | null): void {
    this.current = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Loads the stored session (the server checks it on the first request). */
  async restore(): Promise<Session | null> {
    this.set(await readSession());
    return this.current;
  }

  async login(email: string, password: string): Promise<Session> {
    const res = await this.fetch(`${await this.baseUrl()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const session = (await res.json()) as Session;
    await writeSession(session);
    this.set(session);
    return session;
  }

  /** Revokes the token on the server when reachable; always signs out on the device. */
  async logout(): Promise<void> {
    const token = this.current?.token;
    if (token) {
      try {
        await this.fetch(`${await this.baseUrl()}/api/v1/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // Offline: the token stays valid on the server until an ADMIN revokes it.
      }
    }
    await this.signOut();
  }

  /** Local sign-out (401 or logout). */
  async signOut(): Promise<void> {
    await deleteSession();
    this.set(null);
    this.deps.onSignedOut?.();
  }

  /** The office label of the signed-in user's views (FR-36 summary); null when signed out. */
  async loadOffice(): Promise<string | null> {
    const { ApiClient, UnauthorizedError } = await import("./api");
    try {
      const summary = await new ApiClient(this).get<{ office: string | null }>("/api/v1/stats/summary");
      return summary.office;
    } catch (err) {
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }
  }
}
