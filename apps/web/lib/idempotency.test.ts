import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { route } from "./api";
import { IDEMPOTENCY_TTL_MS, idempotencyStore } from "./idempotency";
import { getSessionUser } from "./session";

vi.mock("./session", () => ({ getSessionUser: vi.fn() }));
const session = vi.mocked(getSessionUser);

const req = (body: unknown, key?: string, path = "/api/v1/thing") =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key === undefined ? {} : { "Idempotency-Key": key }) },
    body: JSON.stringify(body),
  });

// P3-T08: Idempotency-Key (24 h, in-memory, D-04). Behaviour decided 2026-10-18.
describe("Idempotency-Key (P3-T08)", () => {
  let runs: number;
  let status: number;
  const handler = route({ minRole: "ADMIN", idempotent: true, body: z.object({ n: z.number() }) }, async ({ body }) => {
    runs++;
    return Response.json({ run: runs, n: body.n }, { status });
  });

  beforeEach(() => {
    runs = 0;
    status = 202;
    idempotencyStore.clear();
    session.mockResolvedValue({ id: 1, email: "admin@noc.test", role: "ADMIN" });
  });
  afterEach(() => vi.useRealTimers());

  it("replays the cached 2xx without running again", async () => {
    const first = await handler(req({ n: 1 }, "k-1"));
    const again = await handler(req({ n: 1 }, "k-1"));
    expect(runs).toBe(1);
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(await first.json());
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.headers.get("Content-Type")).toContain("application/json");
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
  });

  it("runs every time without the header", async () => {
    await handler(req({ n: 1 }));
    await handler(req({ n: 1 }));
    expect(runs).toBe(2);
  });

  it("same key with a different body → 422, nothing runs", async () => {
    await handler(req({ n: 1 }, "k-1"));
    const res = await handler(req({ n: 2 }, "k-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(runs).toBe(1);
  });

  it("same key while the first request is still running → 409, nothing runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = route({ minRole: "ADMIN", idempotent: true }, async () => {
      runs++;
      await gate;
      return Response.json({ ok: true });
    });
    const first = slow(req({}, "k-slow"));
    await vi.waitFor(() => expect(runs).toBe(1));
    const second = await slow(req({}, "k-slow"));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    release();
    expect((await first).status).toBe(200);
    expect(runs).toBe(1);
  });

  it("does not cache a non-2xx response; the key can be used again", async () => {
    status = 500;
    expect((await handler(req({ n: 1 }, "k-1"))).status).toBe(500);
    status = 202;
    expect((await handler(req({ n: 1 }, "k-1"))).status).toBe(202);
    expect(runs).toBe(2);
  });

  it("does not cache a validation error", async () => {
    expect((await handler(req({ n: "x" }, "k-1"))).status).toBe(400);
    expect((await handler(req({ n: 1 }, "k-1"))).status).toBe(202);
    expect(runs).toBe(1);
  });

  it("scopes keys per user and per path", async () => {
    await handler(req({ n: 1 }, "k-1"));
    session.mockResolvedValue({ id: 2, email: "other@noc.test", role: "ADMIN" });
    await handler(req({ n: 1 }, "k-1"));
    await handler(req({ n: 1 }, "k-1", "/api/v1/other"));
    expect(runs).toBe(3);
  });

  it("forgets a key 24 h after it was stored", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
    await handler(req({ n: 1 }, "k-1"));
    vi.setSystemTime(new Date(Date.parse("2026-10-18T00:00:00Z") + IDEMPOTENCY_TTL_MS - 1));
    await handler(req({ n: 1 }, "k-1"));
    expect(runs).toBe(1);
    vi.setSystemTime(new Date(Date.parse("2026-10-18T00:00:00Z") + IDEMPOTENCY_TTL_MS));
    await handler(req({ n: 1 }, "k-1"));
    expect(runs).toBe(2);
  });

  it("is 24 hours", () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    ["empty", ""],
    ["longer than 255", "k".repeat(256)],
    ["with a space", "a b"],
  ])("rejects a key that is %s with 400", async (_n, key) => {
    const res = await handler(req({ n: 1 }, key));
    expect(res.status).toBe(400);
    expect(runs).toBe(0);
  });

  it("ignores the header on routes without idempotency", async () => {
    const plain = route({ minRole: "ADMIN" }, async () => {
      runs++;
      return { ok: true };
    });
    await plain(req({}, "k-1"));
    await plain(req({}, "k-1"));
    expect(runs).toBe(2);
  });
});
