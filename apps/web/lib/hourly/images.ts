// FR-63: the filtered rows as PNG table images — compact or visible columns, 25/40/60/100 rows per
// image (default 40), separate image sets per category by default. NFR-38: Web Share with files and
// clipboard images need a secure context; otherwise the images are downloaded. Browser only.
import type { HourlyRow } from "@alarm/core";
import { cellText, HOURLY_COLUMNS, officeFills, type HourlyColumn } from "./columns";

export const ROWS_PER_IMAGE = [25, 40, 60, 100] as const;
export const DEFAULT_ROWS_PER_IMAGE = 40;
export const COMPACT_COLUMNS: HourlyColumn[] = ["siteCode", "siteName", "alarmName", "alarmTime", "office"];

export interface ImageOptions {
  columns: HourlyColumn[];
  rowsPerImage: number;
  perCategory: boolean;
  title: string;
}

export interface TableImage {
  name: string;
  blob: Blob;
}

/** Splits rows into image pages (per category first when asked). */
export function imagePages(rows: HourlyRow[], rowsPerImage: number, perCategory: boolean) {
  const groups = perCategory
    ? (["DOWN", "POWER", "OTHER"] as const).map((c) => ({ label: c, rows: rows.filter((r) => r.category === c) })).filter((g) => g.rows.length)
    : [{ label: "ALL", rows }];
  return groups.flatMap((g) => {
    const pages = Math.max(1, Math.ceil(g.rows.length / rowsPerImage));
    return Array.from({ length: pages }, (_, i) => ({
      label: g.label,
      page: i + 1,
      pages,
      rows: g.rows.slice(i * rowsPerImage, (i + 1) * rowsPerImage),
    }));
  });
}

const ROW_H = 26;
const PAD = 8;
const FONT = "13px system-ui, sans-serif";

export async function renderTableImages(rows: HourlyRow[], opts: ImageOptions): Promise<TableImage[]> {
  const fills = officeFills(rows);
  const out: TableImage[] = [];
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = FONT;
  for (const p of imagePages(rows, opts.rowsPerImage, opts.perCategory)) {
    const head = opts.columns.map((c) => HOURLY_COLUMNS[c].header);
    const body = p.rows.map((r) => opts.columns.map((c) => cellText(HOURLY_COLUMNS[c].value(r))));
    const widths = head.map((h, i) => Math.min(360, Math.max(measure.measureText(h).width, ...body.map((b) => measure.measureText(b[i]!).width)) + 2 * PAD));
    const width = Math.ceil(widths.reduce((a, b) => a + b, 0));
    const height = (body.length + 2) * ROW_H;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, width, height);
    g.font = `bold ${FONT}`;
    g.fillStyle = "#000";
    g.textBaseline = "middle";
    g.fillText(`${opts.title} — ${p.label} ${p.page}/${p.pages}`, PAD, ROW_H / 2);

    const drawRow = (cells: string[], y: number, bg: string | null, bold: boolean) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, y, width, ROW_H);
      }
      g.font = bold ? `bold ${FONT}` : FONT;
      g.fillStyle = "#000";
      let x = 0;
      cells.forEach((c, i) => {
        g.save();
        g.beginPath();
        g.rect(x, y, widths[i]!, ROW_H);
        g.clip();
        g.fillText(c, x + PAD, y + ROW_H / 2);
        g.restore();
        x += widths[i]!;
      });
      g.strokeStyle = "#ccc";
      g.strokeRect(0, y, width, ROW_H);
    };
    drawRow(head, ROW_H, "#e8e8e8", true);
    p.rows.forEach((r, i) => drawRow(body[i]!, (i + 2) * ROW_H, r.office && fills.get(r.office) ? `#${fills.get(r.office)}` : null, false));

    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"));
    out.push({ name: `hourly-${p.label.toLowerCase()}-${p.page}.png`, blob });
  }
  return out;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** NFR-38: Web Share with files where possible (secure context), else download. */
export async function shareImages(images: TableImage[], title: string): Promise<"shared" | "downloaded"> {
  const files = images.map((i) => new File([i.blob], i.name, { type: "image/png" }));
  if (window.isSecureContext && navigator.canShare?.({ files })) {
    await navigator.share({ files, title });
    return "shared";
  }
  images.forEach((i) => download(i.blob, i.name));
  return "downloaded";
}

/** NFR-38: copy one image to the clipboard (secure context only), else download it. */
export async function copyImage(image: TableImage): Promise<"copied" | "downloaded"> {
  if (window.isSecureContext && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
    return "copied";
  }
  download(image.blob, image.name);
  return "downloaded";
}

/** FR-62: "Copy as table" — TSV plus an HTML table. */
export async function copyRowsAsTable(rows: HourlyRow[], columns: HourlyColumn[]): Promise<void> {
  const head = columns.map((c) => HOURLY_COLUMNS[c].header);
  const body = rows.map((r) => columns.map((c) => cellText(HOURLY_COLUMNS[c].value(r))));
  const tsv = [head, ...body].map((r) => r.map((c) => c.replace(/[\t\n]/g, " ")).join("\t")).join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/plain": new Blob([tsv], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) }),
    ]);
  } else {
    await navigator.clipboard.writeText(tsv);
  }
}
