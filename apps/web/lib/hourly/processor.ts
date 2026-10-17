"use client";

// Browser side of D-10: download the attachment (G-T12), process it in a Web Worker, keep the 3 most
// recently used reports in memory (decided 2026-10-17) and clear them on logout.
import { ReportCache, type HourlyRow, type HourlyStats } from "@alarm/core";
import { loadReference } from "./reference";
import type { WorkerRequest, WorkerResponse } from "./worker";

export interface ProcessedReport {
  id: string;
  filename: string;
  rows: HourlyRow[];
  stats: HourlyStats;
  ms: number;
}

export class HourlyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The no-WASM fallback (G-T14): the browser needs Web Workers and WebAssembly. */
export function supportsHourlyProcessing(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly === "object" && typeof indexedDB !== "undefined";
}

export const UNSUPPORTED_MESSAGE =
  "This browser cannot process hourly reports (it needs Web Workers and WebAssembly). Open the report on a laptop with an up-to-date Chrome, Edge, Firefox or Safari.";

const reports = new ReportCache<ProcessedReport>();
/** One processing run per report at a time (React may run effects twice in development). */
const inflight = new Map<string, Promise<ProcessedReport>>();
let worker: Worker | null = null;
let seq = 0;

/** Server limits for the browser checks: HOURLY_MAX_RAR_MB / HOURLY_MAX_EXTRACT_MB defaults (FR-50 … FR-52). */
const LIMITS = { maxRarBytes: 25 * 1024 * 1024, maxExtractBytes: 100 * 1024 * 1024 };

function getWorker(): Worker {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function runWorker(req: Omit<WorkerRequest, "id">): Promise<Extract<WorkerResponse, { ok: true }>> {
  const id = `job-${++seq}`;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (e.data.ok) resolve(e.data);
      else reject(new HourlyError(e.data.code, e.data.message));
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ ...req, id }, [req.bytes]);
  });
}

function filenameOf(res: Response, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return m?.[1] ?? fallback;
}

export function cachedReport(id: string): ProcessedReport | undefined {
  return reports.get(id);
}

export async function processReport(id: string, opts: { force?: boolean } = {}): Promise<ProcessedReport> {
  if (!supportsHourlyProcessing()) throw new HourlyError("UNSUPPORTED_BROWSER", UNSUPPORTED_MESSAGE);
  if (!opts.force) {
    const hit = reports.get(id);
    if (hit) return hit;
  }
  const running = inflight.get(id);
  if (running) return running;
  const job = runReport(id).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

async function runReport(id: string): Promise<ProcessedReport> {
  const [res, reference] = await Promise.all([fetch(`/api/v1/hourly-reports/${encodeURIComponent(id)}/attachment`), loadReference()]);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new HourlyError(body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? res.statusText);
  }
  const filename = filenameOf(res, `${id}.rar`);
  const out = await runWorker({
    filename,
    bytes: await res.arrayBuffer(),
    siteMaster: reference.siteMaster,
    normalizations: reference.normalizations,
    limits: LIMITS,
  });
  const report: ProcessedReport = { id, filename, rows: out.rows, stats: out.stats, ms: out.ms };
  reports.set(id, report);
  return report;
}

/** G-T14: in-memory reports are cleared on logout. */
export function clearReports(): void {
  reports.clear();
  worker?.terminate();
  worker = null;
}
