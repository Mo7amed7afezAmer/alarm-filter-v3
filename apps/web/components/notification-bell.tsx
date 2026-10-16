"use client";

// FR-46: polls the feed every 30 s; badge, pop-up cards for new alarms, optional beep, "(n)" in the
// tab title; "Mark all read" sets notificationsSeenAt.
import { useEffect, useRef, useState } from "react";
import { BELL_POLL_MS, titleWithCount } from "@/lib/alarm-ui";
import { sendJson, useJson } from "./use-json";

interface Feed {
  unread: number;
  sound: boolean;
  items: { id: number; alarmName: string; site: string; category: string; alarmTime: string; unread: boolean }[];
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // No audio available.
  }
}

export function NotificationBell() {
  const { data, reload } = useJson<Feed>("/api/v1/notifications", BELL_POLL_MS);
  const [open, setOpen] = useState(false);
  const [popups, setPopups] = useState<Feed["items"]>([]);
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!data) return;
    document.title = titleWithCount(document.title, data.unread);
    const unread = data.items.filter((i) => i.unread);
    if (seen.current) {
      const fresh = unread.filter((i) => !seen.current!.has(i.id));
      if (fresh.length) {
        setPopups(fresh.slice(0, 3));
        if (data.sound) beep();
        setTimeout(() => setPopups([]), 10_000);
      }
    }
    seen.current = new Set(unread.map((i) => i.id));
  }, [data]);

  async function markAllRead() {
    await sendJson("POST", "/api/v1/notifications/read");
    await reload();
  }

  return (
    <div className="bell">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Notifications, ${data?.unread ?? 0} unread`}>
        🔔{data && data.unread > 0 && <span className="badge count">{data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <button type="button" onClick={() => void markAllRead()}>
            Mark all read
          </button>
          <ul>
            {data?.items.map((i) => (
              <li key={i.id} className={i.unread ? "unread" : undefined}>
                <strong>{i.alarmName}</strong> <span>{i.site}</span> <small>{new Date(i.alarmTime).toLocaleString("en-US")}</small>
              </li>
            ))}
            {data?.items.length === 0 && <li>No notifications.</li>}
          </ul>
        </div>
      )}
      <div className="popups" aria-live="polite">
        {popups.map((p) => (
          <div key={p.id} className="popup">
            <strong>{p.alarmName}</strong>
            <span>{p.site}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
