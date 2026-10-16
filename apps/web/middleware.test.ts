import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
const token = vi.mocked(getToken);
const req = (path: string) => new NextRequest(`http://localhost${path}`);

describe("middleware (FR-26, NFR-17)", () => {
  beforeEach(() => token.mockReset());

  it("redirects an unauthenticated page request to /login", async () => {
    token.mockResolvedValue(null);
    const res = await middleware(req("/alarms"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("answers 401 JSON for an unauthenticated API call", async () => {
    token.mockResolvedValue(null);
    const res = await middleware(req("/api/v1/users"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it.each(["/api/auth/session", "/api/auth/callback/credentials", "/api/health", "/login"])(
    "lets %s through without a session",
    async (path) => {
      token.mockResolvedValue(null);
      const res = await middleware(req(path));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("lets signed-in requests through", async () => {
    token.mockResolvedValue({ id: 1, role: "VIEWER" } as never);
    expect((await middleware(req("/alarms"))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(req("/api/v1/users"))).headers.get("x-middleware-next")).toBe("1");
  });
});
