import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, route } from "./api";
import { getSessionUser } from "./session";

vi.mock("./session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const req = (url = "http://localhost/api/v1/x", init?: RequestInit) => new Request(url, init);

describe("route(): /api/v1 layer (NFR-17, NFR-18, NFR-23, FR-26, FR-27)", () => {
  beforeEach(() => session.mockReset());

  it("401 with the error envelope when there is no session", async () => {
    session.mockResolvedValue(null);
    const res = await route({ minRole: "VIEWER" }, async () => ({ ok: true }))(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it.each([
    ["VIEWER", "OPERATOR", 403],
    ["VIEWER", "ADMIN", 403],
    ["OPERATOR", "ADMIN", 403],
    ["OPERATOR", "OPERATOR", 200],
    ["ADMIN", "OPERATOR", 200],
    ["ADMIN", "VIEWER", 200],
  ] as const)("role %s on a %s route → %i", async (role, minRole, status) => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role });
    const res = await route({ minRole }, async () => ({ ok: true }))(req());
    expect(res.status).toBe(status);
    if (status === 403) expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("400 with flattened zod errors for an invalid query", async () => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role: "VIEWER" });
    const handler = route({ minRole: "VIEWER", query: z.object({ page: z.coerce.number().int().min(1) }) }, async ({ query }) => query);
    const res = await handler(req("http://localhost/api/v1/x?page=0"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.details.fieldErrors.page).toBeDefined();
  });

  it("400 for an invalid or non-JSON body", async () => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role: "VIEWER" });
    const handler = route({ minRole: "VIEWER", body: z.object({ name: z.string().min(1) }) }, async ({ body }) => body);
    const bad = await handler(req(undefined, { method: "POST", body: JSON.stringify({ name: "" }) }));
    expect(bad.status).toBe(400);
    const notJson = await handler(req(undefined, { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
  });

  it("passes parsed input and returns JSON", async () => {
    session.mockResolvedValue({ id: 7, email: "u@noc.test", role: "ADMIN" });
    const handler = route(
      { minRole: "VIEWER", query: z.object({ q: z.string() }), body: z.object({ n: z.number() }) },
      async ({ user, query, body }) => ({ user: user.id, q: query.q, n: body.n }),
    );
    const res = await handler(req("http://localhost/api/v1/x?q=a", { method: "POST", body: JSON.stringify({ n: 2 }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 7, q: "a", n: 2 });
  });

  it("maps ApiError to its status and envelope", async () => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role: "ADMIN" });
    const res = await route({ minRole: "VIEWER" }, async () => {
      throw new ApiError(404, "NOT_FOUND", "user 9 not found");
    })(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "user 9 not found" } });
  });

  it("500 with a generic message for unexpected errors", async () => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role: "ADMIN" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route({ minRole: "VIEWER" }, async () => {
      throw new Error("secret detail");
    })(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  it("passes route params to the handler", async () => {
    session.mockResolvedValue({ id: 1, email: "u@noc.test", role: "ADMIN" });
    const handler = route({ minRole: "VIEWER", params: z.object({ id: z.coerce.number().int() }) }, async ({ params }) => params);
    const res = await handler(req(), { params: { id: "12" } });
    expect(await res.json()).toEqual({ id: 12 });
  });
});
