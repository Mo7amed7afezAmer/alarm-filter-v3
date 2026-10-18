import { Validator } from "@seriousme/openapi-schema-validator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/openapi.json/route";
import { buildOpenApi, openApiPath } from "@/lib/openapi";
import { ROUTES } from "@/lib/routes";
import { getSessionUser } from "@/lib/session";
import { jsonRequest } from "./db";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

type Operation = {
  "x-min-role"?: string;
  security?: unknown[];
  parameters?: { name: string; in: string; schema?: { enum?: string[] } }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
};
type Spec = { openapi: string; paths: Record<string, Record<string, Operation>> };

// P3-T03: OpenAPI 3.1 generated from the routes' zod schemas (zod-to-openapi), served to ADMIN only.
describe("OpenAPI 3.1 (P3-T03)", () => {
  let spec: Spec;

  beforeAll(async () => {
    spec = (await buildOpenApi()) as Spec;
  });
  beforeEach(() => session.mockReset());

  it("is OpenAPI 3.1 and validates against the 3.1 schema", async () => {
    expect(spec.openapi).toBe("3.1.0");
    const result = await new Validator().validate(spec as never);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s appears with its minimum role", (_n, r) => {
    const op = spec.paths[openApiPath(r.path)]?.[r.method.toLowerCase()];
    expect(op, `${r.method} ${openApiPath(r.path)}`).toBeDefined();
    expect(op!["x-min-role"]).toBe(r.minRole);
    expect(op!.security).toEqual([{ session: [] }, { bearer: [] }]);
  });

  it("lists exactly the protected routes, the spec itself and the public /api/health", () => {
    const listed = Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`));
    const expected = [...ROUTES.map((r) => `${r.method} ${openApiPath(r.path)}`), "GET /api/health", "POST /api/v1/auth/login"];
    expect(listed.sort()).toEqual([...new Set(expected)].sort());
    expect(spec.paths["/api/health"]!.get!.security).toEqual([]);
    expect(spec.paths["/api/v1/auth/login"]!.post!.security).toEqual([]);
  });

  it("takes query, path and body schemas from the routes' zod schemas", () => {
    const alarms = spec.paths["/api/v1/alarms"]!.get!;
    const status = alarms.parameters!.find((p) => p.name === "status" && p.in === "query");
    expect(status?.schema?.enum).toEqual(["active", "cleared"]);

    const patchUser = spec.paths["/api/v1/users/{id}"]!.patch!;
    expect(patchUser.parameters!.some((p) => p.name === "id" && p.in === "path")).toBe(true);

    const rules = spec.paths["/api/v1/rules"]!.put!.requestBody!.content["application/json"]!.schema as {
      properties: { rules: { maxItems: number } };
    };
    expect(rules.properties.rules.maxItems).toBe(500);
  });

  it.each([
    ["put", "/api/v1/rules"],
    ["post", "/api/v1/site-master/import"],
    ["post", "/api/v1/reprocess"],
  ])("%s %s documents the optional Idempotency-Key header (P3-T08)", (method, path) => {
    const header = spec.paths[path]![method]!.parameters?.find((p) => p.in === "header" && p.name === "Idempotency-Key");
    expect(header).toBeDefined();
  });

  it("GET /api/v1/openapi.json → 200 with the spec for an ADMIN", async () => {
    session.mockResolvedValue({ id: 1, email: "admin@noc.test", role: "ADMIN" });
    const res = await GET(jsonRequest("GET", "/api/v1/openapi.json"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Spec).openapi).toBe("3.1.0");
  });

  it.each(["VIEWER", "OPERATOR"] as const)("GET /api/v1/openapi.json → 403 for %s", async (role) => {
    session.mockResolvedValue({ id: 2, email: "u@noc.test", role });
    expect((await GET(jsonRequest("GET", "/api/v1/openapi.json"))).status).toBe(403);
  });

  it("GET /api/v1/openapi.json → 401 without a session", async () => {
    session.mockResolvedValue(null);
    expect((await GET(jsonRequest("GET", "/api/v1/openapi.json"))).status).toBe(401);
  });
});
