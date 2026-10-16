// Hourly report attachment checks (FR-50, FR-51, FR-52, NFR-24). Browser-safe: no Node imports.

export type HourlyErrorCode =
  | "NOT_RAR"
  | "NOT_XLSX"
  | "UNSUPPORTED_ATTACHMENT"
  | "TOO_LARGE"
  | "BAD_SIGNATURE"
  | "BAD_ARCHIVE"
  | "ENCRYPTED"
  | "TOO_MANY_ENTRIES"
  | "UNSAFE_ENTRY"
  | "EXTRACT_TOO_LARGE"
  | "NO_WORKBOOK"
  | "MULTIPLE_WORKBOOKS";

export class HourlyReportError extends Error {
  constructor(
    readonly code: HourlyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface HourlyLimits {
  /** HOURLY_MAX_RAR_MB (25): attachment size limit, also used for plain .xlsx (gap 26). */
  maxRarBytes: number;
  /** HOURLY_MAX_EXTRACT_MB (100): declared uncompressed size limit. */
  maxExtractBytes: number;
}

const MB = 1024 * 1024;

export function limitsFromEnv(env: Record<string, string | undefined>): HourlyLimits {
  const mb = (name: string, fallback: number) => {
    const n = Number(env[name]);
    return env[name] !== undefined && env[name]!.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return { maxRarBytes: Math.floor(mb("HOURLY_MAX_RAR_MB", 25) * MB), maxExtractBytes: Math.floor(mb("HOURLY_MAX_EXTRACT_MB", 100) * MB) };
}

export type AttachmentKind = "rar" | "xlsx" | "other";

export function attachmentKind(filename: string): AttachmentKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".rar")) return "rar";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return "other";
}

/** FR-50: `52 61 72 21 1A 07` ("Rar!\x1A\x07"). */
export const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
/** FR-52: `50 4B 03 04` (a ZIP local file header). */
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** FR-50: extension `.rar`, size ≤ HOURLY_MAX_RAR_MB, RAR signature. */
export function validateRar(filename: string, bytes: Uint8Array, limits: HourlyLimits): void {
  if (attachmentKind(filename) !== "rar") throw new HourlyReportError("NOT_RAR", `${filename} is not a .rar file`);
  if (bytes.length > limits.maxRarBytes) throw new HourlyReportError("TOO_LARGE", `${filename} is larger than the limit`);
  if (!startsWith(bytes, RAR_MAGIC)) throw new HourlyReportError("BAD_SIGNATURE", `${filename} is not a RAR archive`);
}

/**
 * FR-52: the sum of the uncompressed sizes declared in the ZIP central directory, or null when the
 * end-of-central-directory record cannot be found.
 */
export function zipUncompressedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  for (let i = bytes.length - minEocd; i >= Math.max(0, bytes.length - minEocd - 0xffff); i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    const entries = view.getUint16(i + 10, true);
    let p = view.getUint32(i + 16, true);
    let total = 0;
    for (let n = 0; n < entries; n++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return null;
      total += view.getUint32(p + 24, true);
      p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    }
    return total;
  }
  return null;
}

/** FR-52: extension, size ≤ HOURLY_MAX_RAR_MB, ZIP signature, declared uncompressed size ≤ HOURLY_MAX_EXTRACT_MB. */
export function validateXlsx(filename: string, bytes: Uint8Array, limits: HourlyLimits): void {
  if (attachmentKind(filename) !== "xlsx") throw new HourlyReportError("NOT_XLSX", `${filename} is not an .xlsx file`);
  if (bytes.length > limits.maxRarBytes) throw new HourlyReportError("TOO_LARGE", `${filename} is larger than the limit`);
  if (!startsWith(bytes, ZIP_MAGIC)) throw new HourlyReportError("BAD_SIGNATURE", `${filename} is not an .xlsx workbook`);
  const size = zipUncompressedSize(bytes);
  if (size === null) throw new HourlyReportError("BAD_ARCHIVE", `${filename} has no readable ZIP directory`);
  if (size > limits.maxExtractBytes) throw new HourlyReportError("EXTRACT_TOO_LARGE", `${filename} is too large once uncompressed`);
}

/** FR-51 / NFR-24: a relative name without `..`, drive letters, UNC prefixes or control characters. */
export function assertSafeEntryName(name: string): void {
  // eslint-disable-next-line no-control-regex
  const unsafe = !name || /[\u0000-\u001f]/.test(name) || /^([/\\]|[A-Za-z]:)/.test(name) || name.split(/[/\\]/).includes("..");
  if (unsafe) throw new HourlyReportError("UNSAFE_ENTRY", `unsafe entry name in the archive: ${JSON.stringify(name)}`);
}

export interface ArchiveEntry {
  name: string;
  size: number;
  directory: boolean;
}

export const MAX_ENTRIES = 20;

/** FR-51: ≤ 20 entries, safe names, declared size ≤ HOURLY_MAX_EXTRACT_MB, exactly one .xlsx. Returns its name. */
export function checkEntries(entries: ArchiveEntry[], limits: HourlyLimits): string {
  if (entries.length > MAX_ENTRIES) throw new HourlyReportError("TOO_MANY_ENTRIES", `the archive has more than ${MAX_ENTRIES} entries`);
  for (const e of entries) assertSafeEntryName(e.name);
  const declared = entries.reduce((sum, e) => sum + e.size, 0);
  if (declared > limits.maxExtractBytes) throw new HourlyReportError("EXTRACT_TOO_LARGE", "the archive is too large once extracted");
  const workbooks = entries.filter((e) => !e.directory && attachmentKind(e.name) === "xlsx");
  if (workbooks.length === 0) throw new HourlyReportError("NO_WORKBOOK", "the archive holds no .xlsx workbook");
  if (workbooks.length > 1) throw new HourlyReportError("MULTIPLE_WORKBOOKS", "the archive holds more than one .xlsx workbook");
  return workbooks[0]!.name;
}
