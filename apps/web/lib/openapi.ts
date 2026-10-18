// P3-T03: OpenAPI 3.1 for /api/v1, generated from the zod schemas each route declares in `route()`
// (lib/api.ts) with zod-to-openapi. ROUTES (lib/routes.ts) is the list of protected routes and their
// minimum roles; every operation carries that role as `x-min-role`.
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";
import { loginBody } from "./api-tokens";
import { ROUTES } from "./routes";

extendZodWithOpenApi(z);

/** `/api/v1/users/:id?x=1` → `/api/v1/users/{id}` */
export const openApiPath = (path: string): string => path.split("?")[0]!.replace(/:(\w+)/g, "{$1}");

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

function asObject(schema: ZodTypeAny | undefined, what: string, at: string): AnyZodObject | undefined {
  if (!schema) return undefined;
  if (!(schema instanceof z.ZodObject)) throw new Error(`${at}: ${what} schema must be a z.object for OpenAPI`);
  return schema;
}

async function generate(): Promise<object> {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "next-auth.session-token",
    description: "NextAuth session cookie from signing in on the web app (`__Secure-next-auth.session-token` over HTTPS).",
  });
  registry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
    description: "API token from POST /api/v1/auth/tokens (P3-T07); acts as its user.",
  });
  const error = registry.register("Error", errorEnvelope);
  const errorBody = (description: string) => ({ description, content: { "application/json": { schema: error } } });

  for (const r of ROUTES) {
    const at = `${r.method} ${r.path}`;
    const spec = (await r.load())[r.method]?.spec;
    if (!spec) throw new Error(`${at}: handler is not built with route()`);
    const validated = Boolean(spec.query || spec.body || spec.params);
    registry.registerPath({
      method: r.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete",
      path: openApiPath(r.path),
      summary: `${r.method} ${openApiPath(r.path)}`,
      description: `Minimum role: ${spec.minRole}.`,
      security: [{ session: [] }, { bearer: [] }],
      "x-min-role": spec.minRole,
      request: {
        query: asObject(spec.query, "query", at),
        params: asObject(spec.params, "path parameters", at),
        body: spec.body ? { content: { "application/json": { schema: spec.body } } } : undefined,
        // P3-T08: optional; a replay within 24 h returns the cached 2xx.
        headers: spec.idempotent ? z.object({ "Idempotency-Key": z.string().min(1).max(255).optional() }) : undefined,
      },
      responses: {
        "2XX": { description: "Success" },
        ...(validated ? { 400: errorBody("Invalid input (zod errors in `details`)") } : {}),
        401: errorBody("No session or invalid / revoked API token"),
        403: errorBody(`Requires role ${spec.minRole}`),
      },
    } as Parameters<OpenAPIRegistry["registerPath"]>[0]);
  }

  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/login",
    summary: "POST /api/v1/auth/login",
    description: "Public (decision P7 mobile login): e-mail + password → a new API token of that user; same lockout as the web sign-in.",
    security: [],
    request: { body: { content: { "application/json": { schema: loginBody } } } },
    responses: {
      200: { description: "Token (shown once) and the user" },
      400: errorBody("Invalid input"),
      401: errorBody("Wrong e-mail or password, or the e-mail is locked"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/health",
    summary: "GET /api/health",
    description: "Public (FR-70): 503 when the database is unreachable, else 200 with worker freshness.",
    security: [],
    responses: { 200: { description: "Database reachable" }, 503: { description: "Database unreachable" } },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "NOC Alarm Platform API", version: "1.0.0" },
    servers: [{ url: "/" }],
  });
}

let cached: Promise<object> | undefined;

/** The OpenAPI document; built once per process. */
export function buildOpenApi(): Promise<object> {
  cached ??= generate().catch((err: unknown) => {
    cached = undefined;
    throw err;
  });
  return cached;
}
