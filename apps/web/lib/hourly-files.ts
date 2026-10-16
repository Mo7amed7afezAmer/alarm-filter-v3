// Fetching and checking one report attachment (FR-48, FR-50 … FR-52, NFR-09, NFR-23).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { HourlyReportError, limitsFromEnv, validateRar, validateXlsx, type HourlyLimits } from "@alarm/core";
import { ApiError } from "./api";
import { getHourlyApi, isNotFound, reportAttachment, type ReportAttachment } from "./gmail-hourly";

/** NFR-23: hourly report ids. */
export const REPORT_ID = /^[A-Za-z0-9_-]{6,64}$/;

export function hourlyLimits(): HourlyLimits {
  return limitsFromEnv(process.env);
}

/** The report's attachment metadata: 404 unknown message, 409 no attachment, 413 over the limit. */
export async function reportFile(id: string): Promise<ReportAttachment> {
  let message;
  try {
    message = await getHourlyApi().messagesGet({ id, format: "full" });
  } catch (err) {
    if (isNotFound(err)) throw new ApiError(404, "NOT_FOUND", `report ${id} not found`);
    throw err;
  }
  const attachment = reportAttachment(message);
  if (!attachment) throw new ApiError(409, "NO_ATTACHMENT", `report ${id} has no attachment`);
  if (attachment.size > hourlyLimits().maxRarBytes) {
    throw new ApiError(413, "TOO_LARGE", `${attachment.filename} is larger than HOURLY_MAX_RAR_MB`);
  }
  return attachment;
}

/** Downloads the attachment and checks it (FR-50 for .rar, FR-52 for .xlsx); 422 when invalid. */
export async function downloadChecked(id: string, attachment: ReportAttachment): Promise<Uint8Array> {
  const { data } = await getHourlyApi().attachmentsGet({ messageId: id, id: attachment.attachmentId });
  const bytes = new Uint8Array(Buffer.from(data, "base64url"));
  const limits = hourlyLimits();
  try {
    if (attachment.kind === "rar") validateRar(attachment.filename, bytes, limits);
    else if (attachment.kind === "xlsx") validateXlsx(attachment.filename, bytes, limits);
    else throw new HourlyReportError("UNSUPPORTED_ATTACHMENT", `${attachment.filename} is neither .rar nor .xlsx`);
  } catch (err) {
    throw asApiError(err);
  }
  return bytes;
}

/** FR-58: 422 with the error code of an invalid report; 413 for a size limit. */
export function asApiError(err: unknown): unknown {
  if (!(err instanceof HourlyReportError)) return err;
  return new ApiError(err.code === "TOO_LARGE" ? 413 : 422, err.code, err.message);
}

let wasm: ArrayBuffer | null = null;

/** unrar.wasm of node-unrar-js (D-11: the server unrars for mobile, in memory). */
export function unrarWasm(): ArrayBuffer {
  if (!wasm) {
    // The path is built at run time so the bundler leaves the .wasm file alone.
    const wasmPath = ["node-unrar-js", "esm", "js", "unrar.wasm"].join("/");
    const file = readFileSync(createRequire(import.meta.url).resolve(wasmPath));
    wasm = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  }
  return wasm;
}

/** Streams bytes in 64 KiB chunks. */
export function streamBytes(bytes: Uint8Array, headers: Record<string, string>): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, { headers: { ...headers, "Content-Length": String(bytes.length) } });
}

export const contentDisposition = (filename: string) => `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`;
