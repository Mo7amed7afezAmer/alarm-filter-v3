import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearReference, loadReference, REFERENCE_TTL_MS, REFERENCE_URL } from "./reference";

// G-T14: Site Master + normalizations cached in IndexedDB, revalidated by updatedAt (ETag)
// after 30 minutes (decided 2026-10-17). The endpoint (G-T15) is mocked here.
const siteMaster = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../samples/hourly/site-master.json", import.meta.url)), "utf8"));
const body = { updatedAt: "2026-10-16T10:00:00.000Z", siteMaster, normalizations: [] };

function server(etag = body.updatedAt) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = new Headers(init?.headers).get("If-None-Match");
    if (sent === `"${etag}"`) return new Response(null, { status: 304, headers: { ETag: `"${etag}"` } });
    return Response.json({ ...body, updatedAt: etag }, { headers: { ETag: `"${etag}"` } });
  });
}

describe("loadReference", () => {
  const t0 = Date.parse("2026-10-17T08:00:00Z");
  beforeEach(async () => {
    await clearReference();
  });

  it("downloads once, then a second load makes no request (within 30 min)", async () => {
    const fetch = server();
    const first = await loadReference({ fetch, now: () => t0 });
    expect(first.siteMaster).toHaveLength(siteMaster.length);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(REFERENCE_URL);

    const second = await loadReference({ fetch, now: () => t0 + REFERENCE_TTL_MS - 1 });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("after 30 min sends If-None-Match and keeps the cache on 304", async () => {
    const fetch = server();
    await loadReference({ fetch, now: () => t0 });
    const again = await loadReference({ fetch, now: () => t0 + REFERENCE_TTL_MS });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe(`"${body.updatedAt}"`);
    expect(again.siteMaster).toHaveLength(siteMaster.length);

    // The 304 restarts the 30 minutes.
    await loadReference({ fetch, now: () => t0 + REFERENCE_TTL_MS + 60_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("replaces the cache when updatedAt changed", async () => {
    await loadReference({ fetch: server(), now: () => t0 });
    const changed = server("2026-10-17T07:00:00.000Z");
    const out = await loadReference({ fetch: changed, now: () => t0 + REFERENCE_TTL_MS });
    expect(out.updatedAt).toBe("2026-10-17T07:00:00.000Z");
  });

  it("keeps working from the cache when the server cannot be reached", async () => {
    await loadReference({ fetch: server(), now: () => t0 });
    const down = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const out = await loadReference({ fetch: down, now: () => t0 + 2 * REFERENCE_TTL_MS });
    expect(out.siteMaster).toHaveLength(siteMaster.length);
  });

  it("fails when there is no cache and no server", async () => {
    const down = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(loadReference({ fetch: down, now: () => t0 })).rejects.toThrow();
  });
});
