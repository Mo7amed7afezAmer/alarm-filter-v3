// P7-T02: every /api/v1 call carries the session's API token; a 401 signs the user out.
import type { SessionStore } from "./session";

export class UnauthorizedError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(private readonly session: SessionStore) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = this.session.current?.token;
    if (!token) throw new UnauthorizedError("signed out");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await this.session.fetch(`${await this.session.baseUrl()}${path}`, { ...init, headers });
    if (res.status === 401) {
      await this.session.signOut();
      throw new UnauthorizedError("session expired");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(res.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `request failed (${res.status})`);
    }
    return res;
  }

  async get<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }
}
