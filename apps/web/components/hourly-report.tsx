"use client";

// FR-59 … FR-63 in the browser (D-10): sheet tabs, multi-select filters kept in the URL, column
// chooser (localStorage hourly.columns.v1), virtualised rows coloured by office (NFR-07: row height
// 34, overscan 15), Copy as table, Excel export, PNG images with Share / Download / Copy.
import {
  filterHourlyRows,
  hourlyFacets,
  HOURLY_SHEETS,
  sortHourlyRows,
  type FacetField,
  type HourlyFilter,
  type HourlyRow,
  type HourlySortKey,
} from "@alarm/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cellText, DEFAULT_COLUMNS, HOURLY_COLUMNS, officeFills, type HourlyColumn } from "@/lib/hourly/columns";
import { buildHourlyXlsx } from "@/lib/hourly/export-xlsx";
import {
  COMPACT_COLUMNS,
  copyImage,
  copyRowsAsTable,
  DEFAULT_ROWS_PER_IMAGE,
  download,
  renderTableImages,
  ROWS_PER_IMAGE,
  shareImages,
  type TableImage,
} from "@/lib/hourly/images";
import { HourlyError, processReport, type ProcessedReport } from "@/lib/hourly/processor";

export const COLUMNS_KEY = "hourly.columns.v1";
const ROW_HEIGHT = 34;
const OVERSCAN = 15;
const LIST_KEYS = ["sheet", "region", "office", "alarm", "siteType", "category"] as const;
const FACETS: { key: (typeof LIST_KEYS)[number]; field: FacetField; label: string }[] = [
  { key: "office", field: "office", label: "Office" },
  { key: "region", field: "region", label: "Region" },
  { key: "category", field: "category", label: "Category" },
  { key: "siteType", field: "siteType", label: "Site type" },
  { key: "alarm", field: "alarmName", label: "Alarm" },
];

function filterFromUrl(p: URLSearchParams): HourlyFilter {
  const f: HourlyFilter = {};
  for (const k of LIST_KEYS) {
    const v = p.get(k);
    if (v) (f as Record<string, string[]>)[k] = v.split("|").filter(Boolean);
  }
  if (p.get("vip")) f.vip = p.get("vip") === "1";
  for (const k of ["from", "to", "q"] as const) if (p.get(k)) f[k] = p.get(k)!;
  return f;
}

function useColumnPrefs(): [HourlyColumn[], (c: HourlyColumn[]) => void] {
  const [cols, setCols] = useState<HourlyColumn[]>(DEFAULT_COLUMNS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null") as HourlyColumn[] | null;
      if (Array.isArray(saved) && saved.every((c) => c in HOURLY_COLUMNS)) setCols(saved);
    } catch {
      // ignore
    }
  }, []);
  return [
    cols,
    (c) => {
      setCols(c);
      try {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(c));
      } catch {
        // ignore
      }
    },
  ];
}

function VirtualTable({ rows, columns }: { rows: HourlyRow[]; columns: HourlyColumn[] }) {
  const [top, setTop] = useState(0);
  const viewport = 600;
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + viewport) / ROW_HEIGHT) + OVERSCAN);
  const fills = useMemo(() => officeFills(rows), [rows]);
  return (
    <div className="vtable" style={{ height: viewport }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-testid="hourly-table">
      <div className="vhead" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
        {columns.map((c) => (
          <span key={c}>{HOURLY_COLUMNS[c].header}</span>
        ))}
      </div>
      <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
        {rows.slice(first, last).map((r, i) => (
          <div
            key={first + i}
            className="vrow"
            data-testid="hourly-row"
            style={{
              top: (first + i) * ROW_HEIGHT,
              height: ROW_HEIGHT,
              gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))`,
              background: r.office && fills.get(r.office) ? `#${fills.get(r.office)}` : undefined,
            }}
          >
            {columns.map((c) => (
              <span key={c} title={cellText(HOURLY_COLUMNS[c].value(r))}>
                {cellText(HOURLY_COLUMNS[c].value(r))}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HourlyReport({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [report, setReport] = useState<ProcessedReport | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [columns, setColumns] = useColumnPrefs();
  const [msg, setMsg] = useState<string | null>(null);
  const [imgOpts, setImgOpts] = useState({ compact: true, rowsPerImage: DEFAULT_ROWS_PER_IMAGE, perCategory: true });
  const [images, setImages] = useState<TableImage[]>([]);

  useEffect(() => {
    let live = true;
    setError(null);
    processReport(id)
      .then((r) => live && setReport(r))
      .catch((e: unknown) => live && setError(e instanceof HourlyError ? { code: e.code, message: e.message } : { code: "ERROR", message: String(e) }));
    return () => {
      live = false;
    };
  }, [id]);

  const filter = useMemo(() => filterFromUrl(params), [params]);
  const sheet = params.get("tab") ?? "";
  const sort = (params.get("sort") ?? "") as HourlySortKey | "";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const inSheet = useMemo(() => (report ? report.rows.filter((r) => !sheet || r.sheet === sheet) : []), [report, sheet]);
  const visible = useMemo(() => {
    const f = filterHourlyRows(inSheet, filter);
    return sort ? sortHourlyRows(f, sort, dir) : f;
  }, [inSheet, filter, sort, dir]);
  const facets = useMemo(() => hourlyFacets(inSheet, FACETS.map((f) => f.field)), [inSheet]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const toggle = (k: (typeof LIST_KEYS)[number], value: string) => {
    const cur = new Set((params.get(k) ?? "").split("|").filter(Boolean));
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    setParam(k, [...cur].join("|") || null);
  };

  async function exportXlsx() {
    const bytes = await buildHourlyXlsx(visible, columns);
    download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `hourly-${id}.xlsx`);
  }
  async function makeImages() {
    const imgs = await renderTableImages(visible, {
      columns: imgOpts.compact ? COMPACT_COLUMNS : columns,
      rowsPerImage: imgOpts.rowsPerImage,
      perCategory: imgOpts.perCategory,
      title: report?.filename ?? id,
    });
    setImages(imgs);
    return imgs;
  }

  if (error) {
    return (
      <section>
        <h1>Hourly report</h1>
        <p role="alert" data-testid="hourly-error">
          {error.message} ({error.code})
        </p>
      </section>
    );
  }
  if (!report) return <p data-testid="hourly-processing">Processing the report in your browser…</p>;

  return (
    <section className="hourly">
      <h1>
        {report.filename} <small data-testid="hourly-count">{visible.length.toLocaleString("en-US")}</small> rows
      </h1>
      <p className="muted">
        Processed in <span data-testid="hourly-ms" data-ms={Math.round(report.ms)}>{(report.ms / 1000).toFixed(1)}</span> s · {report.stats.unmatched} unmatched site codes · {report.stats.emptyCodes} empty codes
      </p>

      <nav className="tabs" role="tablist">
        {["", ...HOURLY_SHEETS].map((s) => (
          <button key={s || "all"} role="tab" aria-selected={sheet === s} onClick={() => setParam("tab", s || null)}>
            {s || "All sheets"} ({(s ? report.rows.filter((r) => r.sheet === s) : report.rows).length})
          </button>
        ))}
      </nav>

      <form className="filters hourly-filters" onSubmit={(e) => e.preventDefault()}>
        <label>
          Search
          <input defaultValue={filter.q ?? ""} onChange={(e) => setParam("q", e.target.value || null)} aria-label="Search" />
        </label>
        <label>
          From
          <input defaultValue={filter.from ?? ""} placeholder="YYYY-MM-DD HH:mm:ss" onBlur={(e) => setParam("from", e.target.value || null)} />
        </label>
        <label>
          To
          <input defaultValue={filter.to ?? ""} placeholder="YYYY-MM-DD HH:mm:ss" onBlur={(e) => setParam("to", e.target.value || null)} />
        </label>
        <label>
          VIP
          <select value={params.get("vip") ?? ""} onChange={(e) => setParam("vip", e.target.value || null)}>
            <option value="">All</option>
            <option value="1">VIP only</option>
            <option value="0">Not VIP</option>
          </select>
        </label>
        {FACETS.map(({ key, field, label }) => (
          <details key={key}>
            <summary>
              {label}
              {filter[key]?.length ? ` (${filter[key]!.length})` : ""}
            </summary>
            <ul className="facet">
              {facets[field]?.slice(0, 200).map((f) => (
                <li key={f.value}>
                  <label>
                    <input type="checkbox" checked={!!(filter[key] as string[] | undefined)?.includes(f.value)} onChange={() => toggle(key, f.value)} />{" "}
                    {f.value} ({f.count})
                  </label>
                </li>
              ))}
            </ul>
          </details>
        ))}
        <details>
          <summary>Columns</summary>
          <ul className="facet">
            {(Object.keys(HOURLY_COLUMNS) as HourlyColumn[]).map((c) => (
              <li key={c}>
                <label>
                  <input
                    type="checkbox"
                    checked={columns.includes(c)}
                    onChange={() => setColumns(columns.includes(c) ? columns.filter((x) => x !== c) : [...columns, c])}
                  />{" "}
                  {HOURLY_COLUMNS[c].header}
                </label>
              </li>
            ))}
          </ul>
        </details>
        <label>
          Sort
          <select value={sort} onChange={(e) => setParam("sort", e.target.value || null)}>
            <option value="">Report order</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {HOURLY_COLUMNS[c].header}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setParam("dir", dir === "asc" ? "desc" : null)}>
          {dir === "asc" ? "Ascending" : "Descending"}
        </button>
      </form>

      <div className="actions">
        <button type="button" onClick={() => void exportXlsx()}>
          Export .xlsx
        </button>
        <button type="button" onClick={() => void copyRowsAsTable(visible, columns).then(() => setMsg("Copied as table."))}>
          Copy as table
        </button>
        <label>
          <input type="checkbox" checked={imgOpts.compact} onChange={(e) => setImgOpts({ ...imgOpts, compact: e.target.checked })} /> Compact
          columns
        </label>
        <label>
          <input type="checkbox" checked={imgOpts.perCategory} onChange={(e) => setImgOpts({ ...imgOpts, perCategory: e.target.checked })} /> One
          set per category
        </label>
        <select
          aria-label="Rows per image"
          value={imgOpts.rowsPerImage}
          onChange={(e) => setImgOpts({ ...imgOpts, rowsPerImage: Number(e.target.value) })}
        >
          {ROWS_PER_IMAGE.map((n) => (
            <option key={n} value={n}>
              {n} rows per image
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void makeImages().then((i) => shareImages(i, report.filename)).then((how) => setMsg(how === "shared" ? "Shared." : "Images downloaded."))}>
          Share images
        </button>
        <button type="button" onClick={() => void makeImages().then((imgs) => imgs.forEach((i) => download(i.blob, i.name)))}>
          Download images
        </button>
        {images[0] && (
          <button type="button" onClick={() => void copyImage(images[0]!).then((how) => setMsg(how === "copied" ? "Image copied." : "Image downloaded."))}>
            Copy first image
          </button>
        )}
        {msg && <span role="status">{msg}</span>}
      </div>

      <VirtualTable rows={visible} columns={columns} />
    </section>
  );
}
