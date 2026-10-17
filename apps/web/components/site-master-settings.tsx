"use client";

// G-T15: Site Master import (FR-65), list with search (FR-67) and inline edit of every field
// including phone (FR-66, FR-67). ADMIN only; the page checks the role on the server.
import { useState } from "react";
import { sendJson, useJson } from "./use-json";

interface Site {
  code: string;
  siteName: string | null;
  office: string;
  nodality: string | null;
  vip: boolean;
  siteType: string | null;
  powerSource: string | null;
  battery: string | null;
  phone: string | null;
  region: string | null;
  notes: string | null;
}

type TextField = "siteName" | "office" | "nodality" | "siteType" | "powerSource" | "battery" | "phone" | "notes";
const FIELDS: { key: TextField; label: string }[] = [
  { key: "siteName", label: "Site name" },
  { key: "office", label: "Office" },
  { key: "nodality", label: "Nodality" },
  { key: "siteType", label: "Site type" },
  { key: "powerSource", label: "Power source" },
  { key: "battery", label: "Battery" },
  { key: "phone", label: "Phone" },
  { key: "notes", label: "Notes" },
];

function Import({ onDone }: { onDone: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function upload(file: File) {
    setMsg("Importing…");
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/v1/site-master/import", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setMsg(body?.error?.message ?? res.statusText);
    setMsg(`Imported: ${body.inserted} inserted, ${body.updated} updated, ${body.skipped} skipped.`);
    await onDone();
  }
  return (
    <fieldset>
      <legend>Import</legend>
      <label>
        Site Master workbook (.xlsx, ≤ 5 MB){" "}
        <input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </label>
      {msg && <p role="status">{msg}</p>}
    </fieldset>
  );
}

function Row({ site, onSaved }: { site: Site; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Site | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (!draft) return;
    try {
      const edit = Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key]]));
      await sendJson("PUT", `/api/v1/site-master/${encodeURIComponent(site.code)}`, { ...edit, vip: draft.vip });
      setDraft(null);
      setMsg(null);
      await onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  if (!draft) {
    return (
      <tr data-testid="site-row">
        <td>{site.code}</td>
        {FIELDS.map((f) => (
          <td key={f.key} dir={f.key === "phone" ? "ltr" : undefined}>
            {site[f.key] ?? ""}
          </td>
        ))}
        <td>{site.vip ? "Yes" : "No"}</td>
        <td>
          <button type="button" onClick={() => setDraft(site)}>
            Edit
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr data-testid="site-row">
      <td>{site.code}</td>
      {FIELDS.map((f) => (
        <td key={f.key}>
          <input aria-label={f.label} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
        </td>
      ))}
      <td>
        <input type="checkbox" aria-label="VIP" checked={draft.vip} onChange={(e) => setDraft({ ...draft, vip: e.target.checked })} />
      </td>
      <td>
        <button type="button" onClick={() => void save()}>
          Save
        </button>{" "}
        <button type="button" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {msg && <p role="alert">{msg}</p>}
      </td>
    </tr>
  );
}

export function SiteMasterSettings() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, error, reload } = useJson<{ total: number; items: Site[] }>(
    `/api/v1/site-master?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  return (
    <section className="settings">
      <h1>Site Master</h1>
      <Import onDone={reload} />
      <label>
        Search{" "}
        <input
          value={q}
          placeholder="Code or site name"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p>{(data?.total ?? 0).toLocaleString("en-US")} sites</p>
      <div className="table-scroll">
        <table className="alarms">
          <thead>
            <tr>
              <th>Code</th>
              {FIELDS.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th>VIP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <Row key={s.code} site={s} onSaved={reload} />
            ))}
          </tbody>
        </table>
      </div>
      <nav>
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>{" "}
        Page {page} of {pages}{" "}
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}
