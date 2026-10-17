"use client";

// FR-61: compare two reports in the browser — new and disappeared rows keyed by code|alarmName|dn.
import { diffHourly, type HourlyRow } from "@alarm/core";
import { useEffect, useState } from "react";
import { cellText, HOURLY_COLUMNS, type HourlyColumn } from "@/lib/hourly/columns";
import { HourlyError, processReport } from "@/lib/hourly/processor";

const COLS: HourlyColumn[] = ["sheet", "siteCode", "siteName", "alarmName", "alarmTime", "office", "category"];

function Rows({ title, rows, testid }: { title: string; rows: HourlyRow[]; testid: string }) {
  return (
    <>
      <h2>
        {title} <span data-testid={testid}>{rows.length}</span>
      </h2>
      <table className="alarms">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c}>{HOURLY_COLUMNS[c].header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, i) => (
            <tr key={i}>
              {COLS.map((c) => (
                <td key={c}>{cellText(HOURLY_COLUMNS[c].value(r))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function HourlyCompare({ previous, current }: { previous: string; current: string }) {
  const [diff, setDiff] = useState<ReturnType<typeof diffHourly<HourlyRow>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previous === current) {
      setError("Choose two different reports.");
      return;
    }
    Promise.all([processReport(previous), processReport(current)])
      .then(([a, b]) => setDiff(diffHourly(a.rows, b.rows)))
      .catch((e: unknown) => setError(e instanceof HourlyError ? `${e.message} (${e.code})` : String(e)));
  }, [previous, current]);

  if (error) return <p role="alert">{error}</p>;
  if (!diff) return <p>Processing both reports in your browser…</p>;
  return (
    <section>
      <h1>Compare reports</h1>
      <Rows title="New" rows={diff.new} testid="diff-new" />
      <Rows title="Disappeared" rows={diff.disappeared} testid="diff-gone" />
    </section>
  );
}
