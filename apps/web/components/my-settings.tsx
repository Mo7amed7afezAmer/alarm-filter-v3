"use client";

// Every user: notification prefs (FR-45) and own hidden alarm types (FR-42).
import { useEffect, useState } from "react";
import { HiddenTypes } from "./admin-settings";
import { sendJson, useJson } from "./use-json";

type Cat = "DOWN" | "POWER" | "OTHER";
interface Prefs {
  enabled: boolean;
  sound: boolean;
  categories: Cat[];
  alarmNames: string[];
  sites: string[];
}
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function NotificationPrefs() {
  const { data } = useJson<Prefs>("/api/v1/me/notification-prefs");
  const [p, setP] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setP(data), [data]);
  if (!p) return null;
  const toggle = (c: Cat) => setP({ ...p, categories: p.categories.includes(c) ? p.categories.filter((x) => x !== c) : [...p.categories, c] });
  async function save() {
    try {
      setP((await sendJson("PUT", "/api/v1/me/notification-prefs", p)) as Prefs);
      setMsg("Saved.");
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }
  return (
    <fieldset>
      <legend>Notifications</legend>
      <label>
        <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} /> Enabled
      </label>
      <label>
        <input type="checkbox" checked={p.sound} onChange={(e) => setP({ ...p, sound: e.target.checked })} /> Sound
      </label>
      <div>
        Categories:{" "}
        {(["DOWN", "POWER", "OTHER"] as Cat[]).map((c) => (
          <label key={c}>
            <input type="checkbox" checked={p.categories.includes(c)} onChange={() => toggle(c)} /> {c}
          </label>
        ))}
      </div>
      <label>
        Exact alarm names (one per line)
        <textarea rows={3} defaultValue={p.alarmNames.join("\n")} onBlur={(e) => setP({ ...p, alarmNames: lines(e.target.value) })} />
      </label>
      <label>
        Sites containing (one per line)
        <textarea rows={3} defaultValue={p.sites.join("\n")} onBlur={(e) => setP({ ...p, sites: lines(e.target.value) })} />
      </label>
      <button type="button" onClick={() => void save()}>
        Save
      </button>
      {msg && <p role="status">{msg}</p>}
    </fieldset>
  );
}

export function MySettings() {
  return (
    <section className="settings">
      <h1>My settings</h1>
      <NotificationPrefs />
      <HiddenTypes url="/api/v1/me/display" names="hiddenByMe" />
    </section>
  );
}
