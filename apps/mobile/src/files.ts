// P7-T06: every exported file is a temp file in the cache directory that lives only while the share
// sheet is open; it is deleted in `finally`, whether the share succeeded, failed or was cancelled.
import type { HourlyRow } from "@alarm/core";
import type { HourlyColumn } from "./export/columns";
import { buildHourlyXlsx } from "./export/xlsx";

/** Report files in the cache directory start with this; `sweepReportFiles` removes any left behind. */
export const REPORT_FILE_PREFIX = "hourly-";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The cache directory (expo-file-system `Paths.cache`, i.e. FileSystem.cacheDirectory). */
export interface TempFiles {
  /** Writes `name` in the cache directory and returns its file:// URI. */
  write(name: string, bytes: Uint8Array): Promise<string>;
  remove(uri: string): Promise<void>;
  list(): Promise<{ name: string; uri: string }[]>;
}

/** expo-sharing `shareAsync`: resolves once the share sheet has closed. */
export type Share = (uri: string, options: { mimeType: string; UTI: string; dialogTitle: string }) => Promise<void>;

/** A safe file name for a report id (Gmail ids are already safe). */
export const reportFileName = (id: string, ext: string): string => `${REPORT_FILE_PREFIX}${id.replace(/[^A-Za-z0-9-]/g, "_")}.${ext}`;

/** FR-60: the filtered rows as .xlsx → share sheet → file deleted. */
export async function shareXlsx(files: TempFiles, share: Share, id: string, rows: HourlyRow[], columns: HourlyColumn[]): Promise<void> {
  const bytes = await buildHourlyXlsx(rows, columns);
  const uri = await files.write(reportFileName(id, "xlsx"), bytes);
  try {
    await share(uri, { mimeType: XLSX_MIME, UTI: "org.openxmlformats.spreadsheetml.sheet", dialogTitle: "Share hourly report" });
  } finally {
    await files.remove(uri);
  }
}

/** FR-63: a captured image (react-native-view-shot `tmpfile`) → share sheet → file deleted. */
export async function shareCapture(files: TempFiles, share: Share, capture: () => Promise<string>): Promise<void> {
  const uri = await capture();
  try {
    await share(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share hourly image" });
  } finally {
    await files.remove(uri);
  }
}

/** Removes report files left in the cache directory (app killed during a share); run at start and sign-out. */
export async function sweepReportFiles(files: TempFiles): Promise<void> {
  for (const f of await files.list()) if (f.name.startsWith(REPORT_FILE_PREFIX)) await files.remove(f.uri);
}
