"use client";

// FR-39: counters, a 30-day stacked bar, top-10 sites, MTTR and a sync bar that turns red when the
// last run is older than 300 s or has an error. NFR-06: summary every 60 s, charts every 5 min.
import { CHARTS_REFRESH_MS, DASHBOARD_REFRESH_MS, syncState } from "@/lib/alarm-ui";
import { useJson } from "./use-json";

type Cat = "DOWN" | "POWER" | "OTHER";
interface Summary {
  office: string | null;
  active: Record<Cat, number>;
  overdue: number;
  mttrMinutes: Record<Cat, number | null>;
  last24h: { cleared: number; orphanClears: number; parseErrors: number };
  lastRun: { lastRunAt: string | null; lastRunMessages: number; lastError: string | null };
}
interface Daily {
  days: ({ day: string } & Record<Cat, number>)[];
}
interface Top {
  sites: { site: string; total: number; active: number; region: string | null }[];
}

const CATS: Cat[] = ["DOWN", "POWER", "OTHER"];
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function Dashboard() {
  const summary = useJson<Summary>("/api/v1/stats/summary", DASHBOARD_REFRESH_MS);
  const daily = useJson<Daily>("/api/v1/stats/daily?days=30", CHARTS_REFRESH_MS);
  const top = useJson<Top>("/api/v1/stats/top-sites?limit=10", CHARTS_REFRESH_MS);
  const s = summary.data;
  const state = s ? syncState(s.lastRun.lastRunAt ? new Date(s.lastRun.lastRunAt) : null, s.lastRun.lastError, new Date()) : null;
  const max = Math.max(1, ...(daily.data?.days ?? []).map((d) => d.DOWN + d.POWER + d.OTHER));

  return (
    <section className="dashboard">
      <h1>Dashboard {s?.office ? `· ${s.office}` : ""}</h1>
      {state && (
        <p className={`sync ${state}`} data-testid="sync-bar">
          Last sync {s?.lastRun.lastRunAt ? new Date(s.lastRun.lastRunAt).toLocaleString("en-US") : "never"}
          {s?.lastRun.lastError ? ` — ${s.lastRun.lastError}` : ""}
        </p>
      )}
      {summary.error && <p role="alert">{summary.error}</p>}

      <div className="counters">
        {CATS.map((c) => (
          <div key={c} className="counter">
            <span>{c}</span>
            <strong>{s ? num.format(s.active[c]) : "…"}</strong>
            <small>MTTR {s?.mttrMinutes[c] == null ? "—" : `${num.format(s.mttrMinutes[c]!)} min`}</small>
          </div>
        ))}
        <div className="counter">
          <span>Overdue</span>
          <strong>{s ? num.format(s.overdue) : "…"}</strong>
        </div>
        <div className="counter">
          <span>Last 24 h</span>
          <small>
            {s
              ? `${num.format(s.last24h.cleared)} cleared · ${num.format(s.last24h.orphanClears)} orphan · ${num.format(s.last24h.parseErrors)} parse errors`
              : "…"}
          </small>
        </div>
      </div>

      <h2>Last 30 days</h2>
      <div className="bars" role="img" aria-label="Alarms per day, last 30 days">
        {daily.data?.days.map((d) => (
          <div key={d.day} className="bar" title={`${d.day}: ${d.DOWN} DOWN, ${d.POWER} POWER, ${d.OTHER} OTHER`}>
            {CATS.map((c) => (
              <span key={c} className={`seg ${c.toLowerCase()}`} style={{ height: `${(d[c] / max) * 100}%` }} />
            ))}
          </div>
        ))}
      </div>

      <h2>Top sites</h2>
      <table className="alarms">
        <thead>
          <tr>
            <th>Site</th>
            <th>Region</th>
            <th>Total</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {top.data?.sites.map((t) => (
            <tr key={t.site}>
              <td>{t.site}</td>
              <td>{t.region ?? "—"}</td>
              <td>{num.format(t.total)}</td>
              <td>{num.format(t.active)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
