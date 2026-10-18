// P3-T08: Idempotency-Key for PUT /rules, POST /site-master/import and POST /reprocess. In-memory
// (single web replica, D-04); a key is scoped to user + method + path and kept 24 h. Only 2xx
// responses are cached; behaviour decided 2026-10-18 (docs/DECISIONS.md "P3-T08 behaviour").
import { createHash } from "node:crypto";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** 1–255 visible ASCII characters. */
export const isValidIdempotencyKey = (key: string): boolean => /^[\x21-\x7E]{1,255}$/.test(key);

interface Cached {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

type Entry = { hash: string; running: true } | { hash: string; running: false; cached: Cached; expiresAt: number };

export type Begin = { kind: "run" } | { kind: "replay"; response: Response } | { kind: "in_progress" } | { kind: "reused" };

export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  /** Claims `scope` for a new request, or says why it must not run. */
  begin(scope: string, hash: string): Begin {
    this.purge();
    const entry = this.entries.get(scope);
    if (!entry) {
      this.entries.set(scope, { hash, running: true });
      return { kind: "run" };
    }
    if (entry.hash !== hash) return { kind: "reused" };
    if (entry.running) return { kind: "in_progress" };
    const { status, headers, body } = entry.cached;
    return { kind: "replay", response: new Response(body.slice(0), { status, headers: [...headers, ["Idempotent-Replayed", "true"]] }) };
  }

  /** Caches a 2xx response for 24 h; any other response releases the key. */
  async finish(scope: string, hash: string, res: Response): Promise<void> {
    if (res.status < 200 || res.status > 299) {
      this.entries.delete(scope);
      return;
    }
    const body = await res.clone().arrayBuffer();
    const headers = [...res.headers.entries()].filter(([name]) => name.toLowerCase() !== "set-cookie");
    this.entries.set(scope, {
      hash,
      running: false,
      cached: { status: res.status, headers, body },
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  private purge(): void {
    const now = Date.now();
    for (const [scope, entry] of this.entries) if (!entry.running && entry.expiresAt <= now) this.entries.delete(scope);
  }
}

export const idempotencyStore = new IdempotencyStore();

/**
 * SHA-256 of the request body. A multipart body is hashed by its field names, file names and
 * contents, so a retry with a new boundary matches.
 */
export async function requestHash(req: Request): Promise<string> {
  const hash = createHash("sha256");
  const copy = req.clone();
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    const form = await copy.formData().catch(() => null);
    if (form) {
      for (const [name, value] of form.entries()) {
        hash.update(`${name}\u0000`);
        if (typeof value === "string") hash.update(`s\u0000${value}\u0000`);
        else
          hash
            .update(`f\u0000${value.name}\u0000`)
            .update(new Uint8Array(await value.arrayBuffer()))
            .update("\u0000");
      }
      return hash.digest("hex");
    }
  }
  return hash.update(new Uint8Array(await copy.arrayBuffer())).digest("hex");
}
