/// <reference lib="webworker" />
// D-10: hourly reports are processed in the browser, off the UI thread: RAR checks and unrar
// (node-unrar-js WASM, FR-50/FR-51) or the plain .xlsx checks (FR-52), SheetJS, then the core
// pipeline (FR-53 … FR-56).
import {
  attachmentKind,
  extractXlsxFromRar,
  HourlyReportError,
  HOURLY_SHEETS,
  processWorkbook,
  validateRar,
  validateXlsx,
  type HourlyRow,
  type HourlyStats,
  type NormalizationRule,
  type SiteMasterRecord,
} from "@alarm/core";
import * as XLSX from "xlsx";

export interface WorkerRequest {
  id: string;
  filename: string;
  bytes: ArrayBuffer;
  siteMaster: SiteMasterRecord[];
  normalizations: NormalizationRule[];
  limits: { maxRarBytes: number; maxExtractBytes: number };
}

export type WorkerResponse =
  | { id: string; ok: true; rows: HourlyRow[]; stats: HourlyStats; ms: number }
  | { id: string; ok: false; code: string; message: string };

let wasm: Promise<ArrayBuffer> | null = null;
const unrarWasm = () => (wasm ??= fetch("/unrar.wasm").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("unrar.wasm missing")))));

/** Lighter SheetJS read (G-T14 spike): values only, the six hourly sheets only. */
const READ_OPTIONS: XLSX.ParsingOptions = {
  type: "array",
  dense: true,
  cellText: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  sheets: [...HOURLY_SHEETS],
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, filename, siteMaster, normalizations, limits } = e.data;
  const started = performance.now();
  try {
    const bytes = new Uint8Array(e.data.bytes);
    let workbook: Uint8Array;
    const kind = attachmentKind(filename);
    if (kind === "rar") {
      validateRar(filename, bytes, limits);
      workbook = (await extractXlsxFromRar(bytes, limits, await unrarWasm())).data;
    } else if (kind === "xlsx") {
      validateXlsx(filename, bytes, limits);
      workbook = bytes;
    } else {
      throw new HourlyReportError("UNSUPPORTED_ATTACHMENT", `${filename} is neither .rar nor .xlsx`);
    }
    const book = XLSX.read(workbook, READ_OPTIONS);
    const sheets = Object.fromEntries(
      book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[n]!, { raw: true, defval: "" })]),
    );
    const { rows, stats } = processWorkbook(sheets, siteMaster, normalizations);
    const reply: WorkerResponse = { id, ok: true, rows, stats, ms: performance.now() - started };
    self.postMessage(reply);
  } catch (err) {
    const reply: WorkerResponse =
      err instanceof HourlyReportError
        ? { id, ok: false, code: err.code, message: err.message }
        : { id, ok: false, code: "PROCESSING_FAILED", message: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};

