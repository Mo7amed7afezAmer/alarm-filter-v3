import { describe, expect, it } from "vitest";
import { FETCH_CONCURRENCY, ingestOnce, MemorySink, type IngestOptions } from "./ingest";
import { GONE_ID, GmailHttpError, LABEL, MockGmail, SAMPLE_IDS } from "./test/mock-gmail";

const NOW = new Date("2026-10-11T19:00:00Z");
const FETCHABLE = SAMPLE_IDS.filter((id) => id !== GONE_ID);

const options = (over: Partial<IngestOptions> = {}): IngestOptions => ({
  lastHistoryId: "8000",
  officeChanged: false,
  label: LABEL,
  office: LABEL.name,
  now: NOW,
  backfillHours: 24,
  maxPerRun: 200,
  query: "",
  ...over,
});

describe("ingestOnce (FR-02 … FR-06)", () => {
  it("history path: stores every new message once, tagged with the office", async () => {
    const gmail = new MockGmail();
    const sink = new MemorySink();
    const result = await ingestOnce(gmail, sink, options());

    expect(result).toMatchObject({ mode: "history", inserted: FETCHABLE.length, throttled: false, nextHistoryId: "8100" });
    expect(sink.rows.map((r) => r.gmailId)).toEqual(FETCHABLE);
    expect(sink.rows.every((r) => r.office === "DN")).toBe(true);
    expect(gmail.count("messagesList")).toBe(0);
  });

  it("first run (no lastHistoryId) falls back to messages.list over INITIAL_BACKFILL_HOURS", async () => {
    const gmail = new MockGmail();
    const sink = new MemorySink();
    const result = await ingestOnce(gmail, sink, options({ lastHistoryId: null }));

    expect(result).toMatchObject({ mode: "backfill", inserted: FETCHABLE.length, nextHistoryId: "8100" });
    const q = (gmail.calls.find((c) => c.method === "messagesList")!.params as { q: string }).q;
    expect(q).toContain(`after:${(NOW.getTime() - 24 * 3600_000) / 1000}`);
    expect(gmail.count("historyList")).toBe(0);
  });

  it("captures the current historyId before listing", async () => {
    const gmail = new MockGmail();
    await ingestOnce(gmail, new MemorySink(), options({ lastHistoryId: null }));
    const order = gmail.calls.map((c) => c.method);
    expect(order.indexOf("getProfile")).toBeLessThan(order.indexOf("messagesList"));
  });

  it("404 on history falls back to messages.list", async () => {
    const gmail = new MockGmail({ historyExpired: true });
    const sink = new MemorySink();
    const result = await ingestOnce(gmail, sink, options());

    expect(result).toMatchObject({ mode: "backfill", inserted: FETCHABLE.length, nextHistoryId: "8100" });
    expect(gmail.count("historyList")).toBe(1);
    expect(gmail.count("messagesList")).toBe(2);
  });

  it("falls back to messages.list when the selected office changed", async () => {
    const gmail = new MockGmail();
    const result = await ingestOnce(gmail, new MemorySink(), options({ officeChanged: true }));
    expect(result.mode).toBe("backfill");
    expect(gmail.count("historyList")).toBe(0);
  });

  it("duplicate message → no new row, and known ids are not fetched again (FR-04)", async () => {
    const sink = new MemorySink();
    await ingestOnce(new MockGmail(), sink, options());
    const again = new MockGmail();
    const result = await ingestOnce(again, sink, options());

    expect(result.inserted).toBe(0);
    expect(sink.rows).toHaveLength(FETCHABLE.length);
    // Only the id that 404s is unknown and asked for again.
    expect(again.count("messagesGet")).toBe(1);
  });

  it("skips a message that messages.get answers with 404", async () => {
    const sink = new MemorySink();
    const result = await ingestOnce(new MockGmail(), sink, options());
    expect(result.skipped).toBe(1);
    expect(sink.rows.some((r) => r.gmailId === GONE_ID)).toBe(false);
  });

  it("caps at MAX_MESSAGES_PER_RUN and holds historyId until drained (FR-05, NFR-12)", async () => {
    const sink = new MemorySink();
    const opts = options({ maxPerRun: 2 });

    const first = await ingestOnce(new MockGmail(), sink, opts);
    expect(first).toMatchObject({ inserted: 2, backlog: SAMPLE_IDS.length - 2, nextHistoryId: null });
    expect(sink.rows.map((r) => r.gmailId)).toEqual(SAMPLE_IDS.slice(0, 2));

    const second = await ingestOnce(new MockGmail(), sink, opts);
    expect(second).toMatchObject({ inserted: 2, nextHistoryId: null });

    // Two left: the 404 id and the newest one. Both fit, so the backlog is drained.
    const third = await ingestOnce(new MockGmail(), sink, opts);
    expect(third).toMatchObject({ inserted: 1, skipped: 1, backlog: 0, nextHistoryId: "8100" });
    expect(sink.rows.map((r) => r.gmailId)).toEqual(FETCHABLE);
  });

  it.each([
    [429, undefined],
    [403, "rateLimitExceeded"],
  ])("quota error %s %s stops fetching, keeps partial results, holds historyId", async (status, reason) => {
    const sink = new MemorySink();
    const gmail = new MockGmail({ failGetFrom: { call: 3, status, reason } });
    const result = await ingestOnce(gmail, sink, options());

    expect(result.throttled).toBe(true);
    expect(result.nextHistoryId).toBeNull();
    expect(result.inserted).toBeGreaterThan(0);
    expect(result.inserted).toBeLessThan(FETCHABLE.length);
    expect(sink.rows.every((r) => SAMPLE_IDS.includes(r.gmailId))).toBe(true);
  });

  it(`fetches at most ${FETCH_CONCURRENCY} messages at a time (NFR-03)`, async () => {
    const gmail = new MockGmail();
    await ingestOnce(gmail, new MemorySink(), options());
    expect(gmail.maxInFlight).toBeGreaterThan(1);
    expect(gmail.maxInFlight).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it("rethrows errors that are neither 404 nor quota", async () => {
    const gmail = new MockGmail({ failGetFrom: { call: 1, status: 500 } });
    await expect(ingestOnce(gmail, new MemorySink(), options())).rejects.toBeInstanceOf(GmailHttpError);
  });
});
