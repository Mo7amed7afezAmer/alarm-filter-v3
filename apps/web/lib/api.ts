// The /api/v1 route layer (D-01, D-02): session or API token (P3-T07) + minimum role (FR-26, FR-27, NFR-17, NFR-18),
// zod validation with 400 + flattened errors (NFR-23), and one error envelope
// `{ error: { code, message, details? } }` for every failure.
import { z, type ZodTypeAny } from "zod";
import { bearerToken, tokenUser } from "./api-tokens";
import { db } from "./db";
import { idempotencyStore, isValidIdempotencyKey, requestHash } from "./idempotency";
import { hasRole, type Role, type SessionUser } from "./roles";
import { getSessionUser } from "./session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: details === undefined ? { code, message } : { code, message, details } }, { status });
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
export const notFound = (message: string) => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);

type Infer<S> = S extends ZodTypeAny ? z.infer<S> : undefined;

export interface RouteOptions<Q, B, P> {
  minRole: Role;
  query?: Q;
  body?: B;
  params?: P;
  /** P3-T08: honour an optional Idempotency-Key header (lib/idempotency.ts). */
  idempotent?: boolean;
}

export interface RouteContext<Q, B, P> {
  req: Request;
  user: SessionUser;
  query: Infer<Q>;
  body: Infer<B>;
  params: Infer<P>;
}

export type RouteHandler = ((req: Request, ctx?: { params?: Record<string, string | string[]> }) => Promise<Response>) & {
  /** P3-T03: the route's minimum role and zod schemas, read by the OpenAPI generator (lib/openapi.ts). */
  spec?: RouteOptions<ZodTypeAny | undefined, ZodTypeAny | undefined, ZodTypeAny | undefined>;
};

function parse<S extends ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(`invalid ${what}`, result.error.flatten());
  return result.data;
}

export function route<
  Q extends ZodTypeAny | undefined = undefined,
  B extends ZodTypeAny | undefined = undefined,
  P extends ZodTypeAny | undefined = undefined,
>(opts: RouteOptions<Q, B, P>, handler: (ctx: RouteContext<Q, B, P>) => Promise<unknown>): RouteHandler {
  const fn: RouteHandler = async (req, ctx) => {
    let claim: { scope: string; hash: string } | undefined;
    const res = await (async () => {
      try {
        // P3-T07: a bearer token, when sent, is the only credential (no fallback to the cookie).
        const token = bearerToken(req);
        const user = token ? await tokenUser(db, token) : await getSessionUser();
        if (!user) return errorResponse(401, "UNAUTHORIZED", token ? "invalid or revoked API token" : "sign in required");
        if (!hasRole(user.role, opts.minRole)) return errorResponse(403, "FORBIDDEN", `requires role ${opts.minRole}`);

        // P3-T08: replay, refuse or claim the Idempotency-Key before anything runs.
        const key = opts.idempotent ? req.headers.get("idempotency-key") : null;
        if (key !== null) {
          if (!isValidIdempotencyKey(key)) throw badRequest("Idempotency-Key must be 1–255 visible ASCII characters");
          const scope = `${user.id} ${req.method} ${new URL(req.url).pathname} ${key}`;
          const hash = await requestHash(req);
          const begun = idempotencyStore.begin(scope, hash);
          if (begun.kind === "replay") return begun.response;
          if (begun.kind === "in_progress")
            throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "a request with this Idempotency-Key is still running");
          if (begun.kind === "reused")
            throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was used with a different request body");
          claim = { scope, hash };
        }

        const query = opts.query ? parse(opts.query, Object.fromEntries(new URL(req.url).searchParams), "query") : undefined;
        const params = opts.params ? parse(opts.params, ctx?.params ?? {}, "path parameters") : undefined;
        let body: unknown;
        if (opts.body) {
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw badRequest("request body must be JSON");
          }
          body = parse(opts.body, raw, "body");
        }

        const result = await handler({ req, user, query, body, params } as RouteContext<Q, B, P>);
        return result instanceof Response ? result : Response.json(result);
      } catch (err) {
        if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, err.details);
        console.error(err);
        return errorResponse(500, "INTERNAL", "internal server error");
      }
    })();
    if (claim) await idempotencyStore.finish(claim.scope, claim.hash, res);
    return res;
  };
  fn.spec = opts;
  return fn;
}
