// The /api/v1 route layer (D-01, D-02): session + minimum role (FR-26, FR-27, NFR-17, NFR-18),
// zod validation with 400 + flattened errors (NFR-23), and one error envelope
// `{ error: { code, message, details? } }` for every failure.
import { z, type ZodTypeAny } from "zod";
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
}

export interface RouteContext<Q, B, P> {
  req: Request;
  user: SessionUser;
  query: Infer<Q>;
  body: Infer<B>;
  params: Infer<P>;
}

export type RouteHandler = (req: Request, ctx?: { params?: Record<string, string | string[]> }) => Promise<Response>;

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
  return async (req, ctx) => {
    try {
      const user = await getSessionUser();
      if (!user) return errorResponse(401, "UNAUTHORIZED", "sign in required");
      if (!hasRole(user.role, opts.minRole)) return errorResponse(403, "FORBIDDEN", `requires role ${opts.minRole}`);

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
  };
}
