// FR-51 in memory (D-10, D-11): extract the one workbook of a report RAR with the WebAssembly build
// of unrar (node-unrar-js). Nothing is written to disk. Browser-safe: no Node imports.
import { createExtractorFromData } from "node-unrar-js";
import { checkEntries, HourlyReportError, validateRar, type HourlyLimits } from "./validate";

export interface ExtractedWorkbook {
  name: string;
  data: Uint8Array;
}

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * Checks the RAR headers first (FR-51: ≤ 20 entries, safe names, declared size, exactly one .xlsx),
 * then extracts that workbook and checks its real size. `wasmBinary` is unrar.wasm; the caller
 * loads it (fetch in the browser, readFile on the server).
 */
export async function extractXlsxFromRar(bytes: Uint8Array, limits: HourlyLimits, wasmBinary: ArrayBuffer): Promise<ExtractedWorkbook> {
  let extractor;
  try {
    extractor = await createExtractorFromData({ data: asArrayBuffer(bytes), wasmBinary });
  } catch {
    throw new HourlyReportError("BAD_ARCHIVE", "the attachment is not a readable RAR archive");
  }

  let name: string;
  try {
    const list = extractor.getFileList();
    const headers = [...list.fileHeaders];
    if (headers.some((h) => h.flags.encrypted) || list.arcHeader.flags.headerEncrypted) {
      throw new HourlyReportError("ENCRYPTED", "the archive is password-protected");
    }
    name = checkEntries(
      headers.map((h) => ({ name: h.name, size: h.unpSize, directory: h.flags.directory })),
      limits,
    );
  } catch (e) {
    if (e instanceof HourlyReportError) throw e;
    throw new HourlyReportError("BAD_ARCHIVE", "the RAR archive could not be read");
  }

  let data: Uint8Array | undefined;
  try {
    const { files } = extractor.extract({ files: [name] });
    for (const f of files) if (f.fileHeader.name === name) data = f.extraction;
  } catch {
    throw new HourlyReportError("BAD_ARCHIVE", "the workbook could not be extracted");
  }
  if (!data) throw new HourlyReportError("NO_WORKBOOK", "the workbook could not be extracted");
  if (data.length > limits.maxExtractBytes) throw new HourlyReportError("EXTRACT_TOO_LARGE", "the workbook is too large");
  return { name: name.split(/[/\\]/).pop()!, data };
}

/** The checks and the extraction together, for an attachment that should be a report RAR. */
export async function workbookFromRar(
  filename: string,
  bytes: Uint8Array,
  limits: HourlyLimits,
  wasmBinary: ArrayBuffer,
): Promise<ExtractedWorkbook> {
  validateRar(filename, bytes, limits);
  return extractXlsxFromRar(bytes, limits, wasmBinary);
}
