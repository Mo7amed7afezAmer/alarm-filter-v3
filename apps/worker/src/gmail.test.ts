import { describe, expect, it } from "vitest";
import {
  BODY_MAX_CHARS,
  currentHistoryId,
  extractText,
  getMessage,
  historySince,
  isQuotaError,
  listSince,
  type GmailPayload,
} from "./gmail";
import { GONE_ID, GmailHttpError, HTML_ONLY_ID, LABEL, MockGmail, SAMPLE_IDS, realMessages } from "./test/mock-gmail";

describe("historySince (FR-02)", () => {
  it("collects added message ids for the read label across pages, oldest first", async () => {
    const gmail = new MockGmail();
    const result = await historySince(gmail, "8000", LABEL.id);
    expect(result).toEqual({ ids: SAMPLE_IDS, historyId: "8100" });
  });

  it("asks for messageAdded + labelAdded on the label id, 500 per page", async () => {
    const gmail = new MockGmail();
    await historySince(gmail, "8000", LABEL.id);
    const first = gmail.calls.find((c) => c.method === "historyList")!.params;
    expect(first).toMatchObject({
      startHistoryId: "8000",
      labelId: LABEL.id,
      historyTypes: ["messageAdded", "labelAdded"],
      maxResults: 500,
    });
    expect(gmail.count("historyList")).toBe(2);
  });

  it('returns "expired" on HTTP 404', async () => {
    expect(await historySince(new MockGmail({ historyExpired: true }), "8000", LABEL.id)).toBe("expired");
  });
});

describe("listSince (FR-03)", () => {
  it("lists ids oldest first across pages with after:<epoch> (label:…) <GMAIL_QUERY>", async () => {
    const gmail = new MockGmail();
    const after = new Date("2026-10-10T18:45:00Z");
    const ids = await listSince(gmail, { after, labelName: LABEL.name, query: "from:alarms" });
    expect(ids).toEqual(SAMPLE_IDS);
    const params = gmail.calls.find((c) => c.method === "messagesList")!.params as { q: string };
    expect(params.q).toBe(`after:${after.getTime() / 1000} (label:"DN") from:alarms`);
  });

  it("omits GMAIL_QUERY when it is empty", async () => {
    const gmail = new MockGmail();
    const after = new Date("2026-10-10T18:45:00Z");
    await listSince(gmail, { after, labelName: LABEL.name, query: "" });
    const params = gmail.calls.find((c) => c.method === "messagesList")!.params as { q: string };
    expect(params.q).toBe(`after:${after.getTime() / 1000} (label:"DN")`);
  });

  it("currentHistoryId reads the profile", async () => {
    expect(await currentHistoryId(new MockGmail())).toBe("8100");
  });
});

describe("getMessage (FR-06)", () => {
  const real = realMessages();

  it.each(SAMPLE_IDS.filter((id) => id !== GONE_ID && id !== HTML_ONLY_ID))(
    "%s: subject, receivedAt = internalDate, text/plain body",
    async (id) => {
      const msg = await getMessage(new MockGmail(), id);
      const r = real.get(id)!;
      expect(msg).toEqual({ gmailId: id, subject: r.subject, receivedAt: new Date(r.receivedAt), body: r.body });
    },
  );

  it("strips tags from an HTML-only body", async () => {
    const msg = await getMessage(new MockGmail(), HTML_ONLY_ID);
    expect(msg!.body).not.toMatch(/<[^>]+>/);
    expect(msg!.body).toContain("CONSEC_NBR");
    expect(msg!.body).toContain("2286612");
    expect(msg!.subject).toBe(real.get(HTML_ONLY_ID)!.subject);
  });

  it("returns null when messages.get answers 404", async () => {
    expect(await getMessage(new MockGmail(), GONE_ID)).toBeNull();
  });
});

describe("extractText", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

  it("prefers text/plain over HTML", () => {
    const payload: GmailPayload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
        { mimeType: "text/plain", body: { data: b64("plain") } },
      ],
    };
    expect(extractText(payload)).toBe("plain");
  });

  it(`keeps at most ${BODY_MAX_CHARS} characters`, () => {
    const long = "x".repeat(BODY_MAX_CHARS + 500);
    expect(extractText({ mimeType: "text/plain", body: { data: b64(long) } })).toHaveLength(BODY_MAX_CHARS);
  });

  it("returns null when there is no text part", () => {
    expect(extractText({ mimeType: "application/octet-stream", body: { size: 0 } })).toBeNull();
  });
});

describe("isQuotaError (FR-06)", () => {
  it.each([
    [new GmailHttpError(429, null), true],
    [new GmailHttpError(403, null, "rateLimitExceeded"), true],
    [new GmailHttpError(403, null, "userRateLimitExceeded"), true],
    [new GmailHttpError(403, null, "quotaExceeded"), true],
    [new GmailHttpError(403, null, "insufficientPermissions"), false],
    [new GmailHttpError(500, null), false],
  ])("%s → %s", (err, expected) => {
    expect(isQuotaError(err)).toBe(expected);
  });
});
