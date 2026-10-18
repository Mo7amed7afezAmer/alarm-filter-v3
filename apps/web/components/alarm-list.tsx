"use client";

// FR-33 / FR-34 / NFR-06 / NFR-37 / NFR-39: alarm lists with filters, live ages, refresh, Site Master
// columns and card views on small screens.
import { useCallback, useEffect, useState } from "react";
import { AGE_TICK_MS, ALARMS_REFRESH_MS, ageText, isAlert, telHref } from "@/lib/alarm-ui";

type Status = "active" | "cleared";

interface AlarmRow {
  id: number;
  alarmName: string;
  site: string;
  category: string;
  alarmTime: string;
  clearTime: string | null;
  durationMin: number | null;
  clearType: string | null;
  consecNbr: string | null;
  cellName: string | null;
  device: string | null;
  siteCode: string | null;
  vip: boolean | null;
  nodality: string | null;
  battery: string | null;
  phone: string | null;
}

interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: AlarmRow[];
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "medium" });
const num = new Intl.NumberFormat("en-US");

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <span>—</span>;
  return (
    <a href={telHref(phone)} dir="ltr">
      {phone}
    </a>
  );
}

function SiteCell({ a }: { a: AlarmRow }) {
  return (
    <span>
      {a.site}
      {a.vip && (
        <span className="badge vip" title="VIP site">
          VIP
        </span>
      )}
    </span>
  );
}

export function AlarmList({ status, alertHours }: { status: Status; alertHours: number }) {
  const now = useNow(AGE_TICK_MS);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status, page: String(page) });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    try {
      const res = await fetch(`/api/v1/alarms?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? res.statusText);
      setData(body as Page);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [status, page, filters]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), ALARMS_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const set = (k: string) => (e: { target: { value: string } }) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  const local = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // FR-35: export the same filters to .xlsx.
  const exportParams = new URLSearchParams({ status });
  for (const [k, v] of Object.entries(filters)) if (v) exportParams.set(k, v);

  return (
    <section>
      <div className="list-head">
        <h1>{status === "active" ? "Active alarms" : "Cleared alarms"}</h1>
        <span data-testid="total">{data ? num.format(data.total) : "…"}</span>
        <a className="export" href={`/api/v1/export?${exportParams}`} download>
          Export .xlsx
        </a>
        <button type="button" className="filters-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Filters
        </button>
      </div>

      <form className={`filters${open ? " open" : ""}`} onSubmit={(e) => e.preventDefault()}>
        <label>
          Category
          <select value={filters.category ?? ""} onChange={set("category")}>
            <option value="">All</option>
            <option value="DOWN">DOWN</option>
            <option value="POWER">POWER</option>
            <option value="OTHER">OTHER</option>
          </select>
        </label>
        <label>
          Site
          <input value={filters.site ?? ""} onChange={set("site")} placeholder="contains…" />
        </label>
        <label>
          Region
          <input value={filters.region ?? ""} onChange={set("region")} maxLength={2} placeholder="DE" />
        </label>
        {status === "active" ? (
          <label>
            Min hours
            <input type="number" min={0} value={filters.minHours ?? ""} onChange={set("minHours")} />
          </label>
        ) : (
          <>
            <label>
              From
              <input
                type="datetime-local"
                onChange={(e) => set("from")({ target: { value: e.target.value ? new Date(e.target.value).toISOString() : "" } })}
              />
            </label>
            <label>
              To
              <input
                type="datetime-local"
                onChange={(e) => set("to")({ target: { value: e.target.value ? new Date(e.target.value).toISOString() : "" } })}
              />
            </label>
          </>
        )}
      </form>

      {error && <p role="alert">{error}</p>}

      <table className="alarms">
        <thead>
          <tr>
            <th>Alarm</th>
            <th>Site</th>
            <th>Category</th>
            <th>{status === "active" ? "Age" : "Cleared"}</th>
            {status === "cleared" && <th>Duration</th>}
            <th>Time</th>
            <th>Nodality</th>
            <th>Battery</th>
            <th>Phone</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((a) => (
            <tr key={a.id} className={status === "active" && isAlert(new Date(a.alarmTime), now, alertHours) ? "alert" : undefined}>
              <td>{a.alarmName}</td>
              <td>
                <SiteCell a={a} />
              </td>
              <td>{a.category}</td>
              <td>{status === "active" ? ageText(new Date(a.alarmTime), now) : local(a.clearTime)}</td>
              {status === "cleared" && <td>{a.durationMin === null ? "—" : `${num.format(a.durationMin)} min`}</td>}
              <td>{local(a.alarmTime)}</td>
              <td>{a.nodality ?? "—"}</td>
              <td>{a.battery ?? "—"}</td>
              <td>
                <Phone phone={a.phone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="cards" aria-label="alarm cards">
        {data?.items.map((a) => (
          <li
            key={a.id}
            data-testid="alarm-card"
            className={status === "active" && isAlert(new Date(a.alarmTime), now, alertHours) ? "card alert" : "card"}
          >
            <strong>{a.alarmName}</strong>
            <SiteCell a={a} />
            <span>
              {a.category} · {status === "active" ? ageText(new Date(a.alarmTime), now) : `cleared ${local(a.clearTime)}`}
            </span>
            <span>
              Nodality {a.nodality ?? "—"} · Battery {a.battery ?? "—"} · <Phone phone={a.phone} />
            </span>
          </li>
        ))}
      </ul>

      <nav className="pager">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}
