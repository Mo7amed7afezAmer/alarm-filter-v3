"use client";

// ADMIN settings: office (FR-40), hidden types for everyone (FR-41), rules (FR-17), reprocess (FR-24).
import { useEffect, useState } from "react";
import { sendJson, useJson } from "./use-json";

type Cat = "DOWN" | "POWER" | "OTHER";
const CATS: Cat[] = ["DOWN", "POWER", "OTHER"];
interface Rule {
  pattern: string;
  category: Cat;
  priority: number;
}

function Status({ msg }: { msg: string | null }) {
  return msg ? <p role="status">{msg}</p> : null;
}

function OfficeSettings() {
  const { data, reload } = useJson<{ office: string | null; availableLabels: string[] }>("/api/v1/settings/office");
  const [msg, setMsg] = useState<string | null>(null);
  async function select(office: string) {
    try {
      await sendJson("PUT", "/api/v1/settings/office", { office });
      setMsg(`Office set to ${office}.`);
      await reload();
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }
  return (
    <fieldset>
      <legend>Office</legend>
      <select value={data?.office ?? ""} onChange={(e) => void select(e.target.value)}>
        <option value="" disabled>
          Select an office…
        </option>
        {data?.availableLabels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <Status msg={msg} />
    </fieldset>
  );
}

export function HiddenTypes({ url, names }: { url: string; names: "hidden" | "hiddenByMe" }) {
  const filter = useJson<{ categories: Cat[]; alarmNames: string[] }>(url);
  const known = useJson<{ names: { alarmName: string; count: number; hidden: boolean; hiddenByMe: boolean }[] }>("/api/v1/alarm-names");
  const [msg, setMsg] = useState<string | null>(null);
  const f = filter.data;
  async function save(next: { categories: Cat[]; alarmNames: string[] }) {
    try {
      await sendJson("PUT", url, next);
      setMsg("Saved.");
      await Promise.all([filter.reload(), known.reload()]);
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  if (!f) return null;
  return (
    <fieldset>
      <legend>Hidden alarm types</legend>
      {CATS.map((c) => (
        <label key={c}>
          <input type="checkbox" checked={f.categories.includes(c)} onChange={() => void save({ ...f, categories: toggle(f.categories, c) })} /> {c}
        </label>
      ))}
      <ul className="names">
        {known.data?.names.map((n) => (
          <li key={n.alarmName}>
            <label>
              <input
                type="checkbox"
                checked={f.alarmNames.includes(n.alarmName)}
                onChange={() => void save({ ...f, alarmNames: toggle(f.alarmNames, n.alarmName) })}
              />{" "}
              {n.alarmName} ({n.count}){names === "hiddenByMe" && n.hidden ? " — hidden by admin" : ""}
            </label>
          </li>
        ))}
      </ul>
      <Status msg={msg} />
    </fieldset>
  );
}

function RulesEditor() {
  const { data, reload } = useJson<{ rules: Rule[] }>("/api/v1/rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data) setRules(data.rules.map(({ pattern, category, priority }) => ({ pattern, category, priority })));
  }, [data]);
  const set = (i: number, patch: Partial<Rule>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    try {
      await sendJson("PUT", "/api/v1/rules", { rules });
      setMsg("Rules saved; existing alarms re-classified.");
      await reload();
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }
  return (
    <fieldset>
      <legend>Classification rules</legend>
      <table className="alarms">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Pattern</th>
            <th>Category</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i}>
              <td>
                <input type="number" min={0} max={100000} value={r.priority} onChange={(e) => set(i, { priority: Number(e.target.value) })} />
              </td>
              <td>
                <input value={r.pattern} maxLength={100} onChange={(e) => set(i, { pattern: e.target.value })} />
              </td>
              <td>
                <select value={r.category} onChange={(e) => set(i, { category: e.target.value as Cat })}>
                  {CATS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td>
                <button type="button" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setRules((r) => [...r, { pattern: "", category: "OTHER", priority: 0 }])}>
        Add rule
      </button>{" "}
      <button type="button" onClick={() => void save()}>
        Save rules
      </button>
      <Status msg={msg} />
    </fieldset>
  );
}

function Reprocess() {
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    try {
      await sendJson("POST", "/api/v1/reprocess", { days });
      setMsg(`Reprocess of the last ${days} days requested; the worker runs it on its next cycle.`);
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }
  return (
    <fieldset>
      <legend>Reprocess</legend>
      <label>
        Days (1–90) <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </label>{" "}
      <button type="button" onClick={() => void run()}>
        Reprocess
      </button>
      <Status msg={msg} />
    </fieldset>
  );
}

export function AdminSettings() {
  return (
    <section className="settings">
      <h1>Settings</h1>
      <OfficeSettings />
      <HiddenTypes url="/api/v1/settings/display" names="hidden" />
      <RulesEditor />
      <Reprocess />
    </section>
  );
}
