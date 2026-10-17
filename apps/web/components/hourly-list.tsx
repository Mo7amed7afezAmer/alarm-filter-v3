"use client";

// FR-47 / FR-64: hourly report list, polled every 60 s; Process only for OPERATOR and ADMIN.
import Link from "next/link";
import { useState } from "react";
import { supportsHourlyProcessing, UNSUPPORTED_MESSAGE } from "@/lib/hourly/processor";
import { useJson } from "./use-json";

export const HOURLY_LIST_REFRESH_MS = 60_000;

interface Report {
  id: string;
  subject: string;
  receivedAt: string;
  attachment: { filename: string; size: number; kind: string } | null;
}

const size = (n: number) => `${(n / 1024 / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;

export function HourlyList({ canProcess }: { canProcess: boolean }) {
  const [tokens, setTokens] = useState<string[]>([]);
  const token = tokens.at(-1);
  const { data, error } = useJson<{ reports: Report[]; nextPageToken: string | null }>(
    `/api/v1/hourly-reports${token ? `?pageToken=${encodeURIComponent(token)}` : ""}`,
    HOURLY_LIST_REFRESH_MS,
  );
  const [pick, setPick] = useState<string[]>([]);
  const supported = typeof window === "undefined" || supportsHourlyProcessing();

  return (
    <section>
      <h1>Hourly reports</h1>
      {!supported && <p role="alert">{UNSUPPORTED_MESSAGE}</p>}
      {error && <p role="alert">{error}</p>}
      {canProcess && pick.length === 2 && (
        <p>
          <Link href={`/hourly/compare?a=${pick[1]}&b=${pick[0]}`}>Compare the two selected reports</Link>
        </p>
      )}
      <table className="alarms">
        <thead>
          <tr>
            {canProcess && <th />}
            <th>Received</th>
            <th>Subject</th>
            <th>Attachment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.reports.map((r) => (
            <tr key={r.id}>
              {canProcess && (
                <td>
                  <input
                    type="checkbox"
                    aria-label="Select for compare"
                    checked={pick.includes(r.id)}
                    onChange={(e) => setPick((p) => (e.target.checked ? [...p, r.id].slice(-2) : p.filter((x) => x !== r.id)))}
                  />
                </td>
              )}
              <td>{new Date(r.receivedAt).toLocaleString("en-US")}</td>
              <td>{r.subject}</td>
              <td>{r.attachment ? `${r.attachment.filename} (${size(r.attachment.size)})` : "—"}</td>
              <td>
                {canProcess && r.attachment && supported ? (
                  <Link href={`/hourly/${r.id}`} data-testid="process">
                    Process
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="pager">
        <button type="button" disabled={!tokens.length} onClick={() => setTokens((t) => t.slice(0, -1))}>
          Newer
        </button>
        <button type="button" disabled={!data?.nextPageToken} onClick={() => setTokens((t) => [...t, data!.nextPageToken!])}>
          Older
        </button>
      </nav>
    </section>
  );
}
