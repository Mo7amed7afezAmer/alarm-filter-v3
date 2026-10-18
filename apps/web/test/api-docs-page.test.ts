import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiDocsPage from "@/app/(app)/api-docs/page";
import { getSessionUser } from "@/lib/session";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("@/components/api-docs", () => ({ ApiDocs: () => null }));
const session = vi.mocked(getSessionUser);

// P3-T03: Swagger UI is for ADMIN only, checked on the server.
describe("/api-docs page (P3-T03)", () => {
  beforeEach(() => session.mockReset());

  it.each(["VIEWER", "OPERATOR"] as const)("redirects %s to /alarms", async (role) => {
    session.mockResolvedValue({ id: 2, email: "u@noc.test", role });
    await expect(ApiDocsPage()).rejects.toThrow("redirect:/alarms");
  });

  it("renders Swagger UI for an ADMIN", async () => {
    session.mockResolvedValue({ id: 1, email: "admin@noc.test", role: "ADMIN" });
    await expect(ApiDocsPage()).resolves.toBeTruthy();
  });
});
