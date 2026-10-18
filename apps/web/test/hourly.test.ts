import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "@/app/api/v1/hourly-reports/route";
import { GET as attachment } from "@/app/api/v1/hourly-reports/[id]/attachment/route";
import { GET as xlsxRoute } from "@/app/api/v1/hourly-reports/[id]/xlsx/route";
import { getHourlyApi } from "@/lib/gmail-hourly";
import { getSessionUser } from "@/lib/session";
import { jsonRequest } from "./db";
import { BIG_ID, hourlyDir, MockHourlyApi, NO_ATTACHMENT_ID, REAL_ID, XLSX_ID } from "./mock-hourly";

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/gmail-hourly", async (orig) => ({ ...(await orig<object>()), getHourlyApi: vi.fn() }));
const session = vi.mocked(getSessionUser);

const rar = new Uint8Array(readFileSync(hourlyDir + "nsn-update-output.rar"));
const xlsx = new Uint8Array(readFileSync(hourlyDir + "nsn-update-output.xlsx"));
const ctx = (id: string) => ({ params: { id } });
// receivedAt of the real report message in samples/bodies.jsonl.
const realReceivedAt = readFileSync(new URL("../../../samples/bodies.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { id: string; receivedAt: string })
  .find((m) => m.id === REAL_ID)!.receivedAt;

// FR-47, FR-48, FR-50 … FR-52, NFR-09, NFR-23; D-10/D-11: list + attachment + server unrar only.
describe("/api/v1/hourly-reports", () => {
  let api: MockHourlyApi;

  beforeEach(() => {
    api = new MockHourlyApi();
    vi.mocked(getHourlyApi).mockReturnValue(api);
    session.mockResolvedValue({ id: 1, email: "op@noc.test", role: "OPERATOR" });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("list (FR-47)", () => {
    it("lists messages of the Hourly Update label with an attachment, 25 per page, without downloading", async () => {
      const res = await list(jsonRequest("GET", "/api/v1/hourly-reports"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nextPageToken).toBe("page-2");
      expect(body.reports).toEqual([
        {
          id: REAL_ID,
          subject: "Nokia (Down & Environmental) Alarms Update Report",
          receivedAt: realReceivedAt,
          attachment: { filename: "NSN Update_Output.rar", size: rar.length, kind: "rar" },
        },
        {
          id: XLSX_ID,
          subject: "Nokia (Down & Environmental) Alarms Update Report",
          receivedAt: "2026-10-11T07:05:00.000Z",
          attachment: { filename: "NSN Update_Output.xlsx", size: xlsx.length, kind: "xlsx" },
        },
      ]);
      expect(api.calls.find((c) => c.method === "messagesList")!.params).toEqual({
        q: 'label:"Hourly Update" has:attachment',
        maxResults: 25,
        pageToken: undefined,
      });
      expect(api.count("attachmentsGet")).toBe(0);
    });

    it("pages with the Gmail page token", async () => {
      const body = await (await list(jsonRequest("GET", "/api/v1/hourly-reports?pageToken=page-2"))).json();
      expect(body.nextPageToken).toBeNull();
      expect(body.reports.map((r: { id: string }) => r.id)).toEqual([NO_ATTACHMENT_ID, BIG_ID]);
      expect(body.reports[0].attachment).toBeNull();
    });

    it("reads the label from HOURLY_GMAIL_LABEL", async () => {
      vi.stubEnv("HOURLY_GMAIL_LABEL", "Reports/Hourly");
      await list(jsonRequest("GET", "/api/v1/hourly-reports"));
      expect((api.calls[0]!.params as { q: string }).q).toBe('label:"Reports/Hourly" has:attachment');
    });

    it("chooses the first .rar, else the first .xlsx, else the first attachment (FR-48)", async () => {
      const body = await (await list(jsonRequest("GET", "/api/v1/hourly-reports"))).json();
      // The real message also carries logo.png and an .xlsx before the .rar.
      expect(body.reports[0].attachment.filename).toBe("NSN Update_Output.rar");
    });
  });

  describe("attachment (FR-48, FR-50, FR-52, NFR-09)", () => {
    it("streams the RAR with the right length and bytes", async () => {
      const res = await attachment(jsonRequest("GET", `/api/v1/hourly-reports/${REAL_ID}/attachment`), ctx(REAL_ID));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe(String(rar.length));
      expect(res.headers.get("content-type")).toBe("application/vnd.rar");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="NSN Update_Output.rar"');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(rar);
    });

    it("streams a plain .xlsx attachment", async () => {
      const res = await attachment(jsonRequest("GET", `/api/v1/hourly-reports/${XLSX_ID}/attachment`), ctx(XLSX_ID));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe(String(xlsx.length));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(xlsx);
    });

    it("409 when the message has no attachment", async () => {
      const res = await attachment(jsonRequest("GET", `/api/v1/hourly-reports/${NO_ATTACHMENT_ID}/attachment`), ctx(NO_ATTACHMENT_ID));
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("NO_ATTACHMENT");
    });

    it("413 over HOURLY_MAX_RAR_MB, without downloading", async () => {
      const res = await attachment(jsonRequest("GET", `/api/v1/hourly-reports/${BIG_ID}/attachment`), ctx(BIG_ID));
      expect(res.status).toBe(413);
      expect(api.count("attachmentsGet")).toBe(0);
    });

    it("413 for an .xlsx over HOURLY_MAX_RAR_MB too (gap 26)", async () => {
      vi.stubEnv("HOURLY_MAX_RAR_MB", "0.1");
      expect((await attachment(jsonRequest("GET", "/x"), ctx(XLSX_ID))).status).toBe(413);
    });

    it("422 with an error code for an attachment without the RAR signature", async () => {
      api.override.set("nsn-update-output.rar", new Uint8Array(1000));
      const res = await attachment(jsonRequest("GET", "/x"), ctx(REAL_ID));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("BAD_SIGNATURE");
    });

    it("404 for an unknown message", async () => {
      expect((await attachment(jsonRequest("GET", "/x"), ctx("unknownmsg00001"))).status).toBe(404);
    });

    it.each(["x", "abc", "has space!", "a".repeat(65)])("400 for the report id %j (NFR-23)", async (id) => {
      expect((await attachment(jsonRequest("GET", "/x"), ctx(id))).status).toBe(400);
    });
  });

  describe("xlsx (D-11, FR-51 in memory)", () => {
    it("unrars the RAR on the server and returns the workbook", async () => {
      const res = await xlsxRoute(jsonRequest("GET", `/api/v1/hourly-reports/${REAL_ID}/xlsx`), ctx(REAL_ID));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(res.headers.get("content-length")).toBe(String(xlsx.length));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(xlsx);
    });

    it("returns a plain .xlsx attachment as it is", async () => {
      const res = await xlsxRoute(jsonRequest("GET", "/x"), ctx(XLSX_ID));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(xlsx);
    });

    it("409 without an attachment, 413 over the limit", async () => {
      expect((await xlsxRoute(jsonRequest("GET", "/x"), ctx(NO_ATTACHMENT_ID))).status).toBe(409);
      expect((await xlsxRoute(jsonRequest("GET", "/x"), ctx(BIG_ID))).status).toBe(413);
    });

    it("422 when the extracted workbook would exceed HOURLY_MAX_EXTRACT_MB", async () => {
      vi.stubEnv("HOURLY_MAX_EXTRACT_MB", "0.001");
      const res = await xlsxRoute(jsonRequest("GET", "/x"), ctx(REAL_ID));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("EXTRACT_TOO_LARGE");
    });
  });

  // NFR-09 / G-T12: web memory stays below 150 MB while a 40 MB RAR streams. The 40 MB RAR is
  // generated with WinRAR (decided 2026-10-16); the test is skipped where rar is not installed.
  const RAR_EXE = ["C:/Program Files/WinRAR/Rar.exe", "/usr/bin/rar", "/usr/local/bin/rar"].find((p) => existsSync(p));
  describe.skipIf(!RAR_EXE)("40 MB RAR stream", () => {
    it("keeps memory growth below 150 MB", async () => {
      const dir = mkdtempSync(join(tmpdir(), "hourly-40mb-"));
      try {
        writeFileSync(join(dir, "padding.bin"), randomBytes(40 * 1024 * 1024));
        execFileSync(RAR_EXE!, ["a", "-m0", "-ep", "-idq", join(dir, "big.rar"), join(dir, "padding.bin")]);
        const big = new Uint8Array(readFileSync(join(dir, "big.rar")));
        expect(big.length).toBeGreaterThan(40 * 1024 * 1024);
        rmSync(join(dir, "padding.bin"));

        vi.stubEnv("HOURLY_MAX_RAR_MB", "50");
        api.override.set("nsn-update-output.rar", big);
        const msg = await api.messagesGet({ id: REAL_ID, format: "full" });
        vi.spyOn(api, "messagesGet").mockResolvedValue({
          ...msg,
          payload: {
            ...msg.payload,
            parts: msg.payload!.parts!.map((p) => (p.filename.endsWith(".rar") ? { ...p, body: { ...p.body, size: big.length } } : p)),
          },
        });

        global.gc?.();
        const base = process.memoryUsage().rss;
        let peak = base;
        const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 5);
        const res = await attachment(jsonRequest("GET", "/x"), ctx(REAL_ID));
        const reader = res.body!.getReader();
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          peak = Math.max(peak, process.memoryUsage().rss);
        }
        clearInterval(sampler);

        expect(res.status).toBe(200);
        expect(received).toBe(big.length);
        expect((peak - base) / 1024 / 1024).toBeLessThan(150);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  });
});
