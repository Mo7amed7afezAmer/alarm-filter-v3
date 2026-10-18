// P7-T03: active / cleared alarm lists on the phone. Same /api/v1/alarms filters as the web (FR-30,
// FR-31), the same refresh rhythm (NFR-06), and the last data kept for offline use with a stale flag.
import { ApiError, UnauthorizedError, type ApiClient } from "./api";

/** NFR-06 (same values as the web, apps/web/lib/alarm-ui.ts). */
export const AGE_TICK_MS = 30_000;
export const ALARMS_REFRESH_MS = 60_000;
export const BADGE_POLL_MS = 30_000;

export interface AlarmFilters {
  status: "active" | "cleared";
  category?: string;
  site?: string;
  region?: string;
  minHours?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AlarmItem {
  id: number;
  alarmName: string;
  site: string;
  category: "DOWN" | "POWER" | "OTHER";
  alarmTime: string;
  clearTime: string | null;
  durationMin: number | null;
  clearType: string | null;
  office: string | null;
  siteCode: string | null;
  vip: boolean | null;
  nodality: string | null;
  battery: string | null;
  phone: string | null;
}

export interface AlarmPage {
  total: number;
  page: number;
  pageSize: number;
  items: AlarmItem[];
}

/** status, page, then the non-empty filters (pageSize when given): the web's query order. */
export function alarmsPath(f: AlarmFilters): string {
  const params = new URLSearchParams({ status: f.status, page: String(f.page ?? 1) });
  for (const k of ["category", "site", "region", "minHours", "from", "to"] as const) {
    const v = f[k];
    if (v) params.set(k, v);
  }
  if (f.pageSize !== undefined) params.set("pageSize", String(f.pageSize));
  return `/api/v1/alarms?${params}`;
}

/** FR-34 on the phone: VIP badge and nodality next to the site. */
export function siteBadges(a: Pick<AlarmItem, "vip" | "nodality">): string[] {
  return [...(a.vip ? ["VIP"] : []), ...(a.nodality ? [a.nodality] : [])];
}

/** FR-33 age text, identical to the web's (checked by apps/web/test/mobile-contract.test.ts). */
export function ageText(alarmTime: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - alarmTime.getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface FeedState {
  data: AlarmPage | null;
  /** true when the server could not be reached and `data` is the last good copy. */
  stale: boolean;
  fetchedAt: Date | null;
  error: string | null;
}

/** Loads alarm pages and remembers the last good page per filter set for offline use. */
export class AlarmFeed {
  private readonly last = new Map<string, { data: AlarmPage; at: Date }>();

  constructor(
    private readonly api: Pick<ApiClient, "get">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(filters: AlarmFilters): Promise<FeedState> {
    const path = alarmsPath(filters);
    try {
      const data = await this.api.get<AlarmPage>(path);
      const at = this.now();
      this.last.set(path, { data, at });
      return { data, stale: false, fetchedAt: at, error: null };
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      const prev = this.last.get(path) ?? null;
      if (err instanceof ApiError) return { data: prev?.data ?? null, stale: false, fetchedAt: prev?.at ?? null, error: err.message };
      return {
        data: prev?.data ?? null,
        stale: true,
        fetchedAt: prev?.at ?? null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  clear(): void {
    this.last.clear();
  }
}

/** FR-46 on the phone: unread count of the notification feed. */
export async function unreadCount(api: Pick<ApiClient, "get">): Promise<number> {
  return (await api.get<{ unread: number }>("/api/v1/notifications")).unread;
}
