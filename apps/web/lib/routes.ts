// NFR-18 / FR-27: every protected /api/v1 route with its minimum role. The role test
// (test/route-table.test.ts) runs each entry as VIEWER and OPERATOR; each task adds its routes.
import type { RouteHandler } from "./api";
import type { Role } from "./roles";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteEntry {
  method: Method;
  path: string;
  minRole: Role;
  load: () => Promise<Partial<Record<Method, RouteHandler>>>;
  /** Path parameters; ":target" is replaced by a user id that exists. */
  params?: Record<string, string>;
  body?: unknown;
}

export const ROUTES: RouteEntry[] = [
  // G-T08
  { method: "GET", path: "/api/v1/users", minRole: "ADMIN", load: () => import("@/app/api/v1/users/route") },
  {
    method: "POST",
    path: "/api/v1/users",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/users/route"),
    body: { email: "created@noc.test", password: "12345678", role: "VIEWER" },
  },
  {
    method: "PATCH",
    path: "/api/v1/users/:id",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/users/[id]/route"),
    params: { id: ":target" },
    body: { role: "OPERATOR" },
  },
  {
    method: "DELETE",
    path: "/api/v1/users/:id",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/users/[id]/route"),
    params: { id: ":target" },
  },
  { method: "GET", path: "/api/v1/me/display", minRole: "VIEWER", load: () => import("@/app/api/v1/me/display/route") },
  {
    method: "PUT",
    path: "/api/v1/me/display",
    minRole: "VIEWER",
    load: () => import("@/app/api/v1/me/display/route"),
    body: { categories: [], alarmNames: [] },
  },
  {
    method: "GET",
    path: "/api/v1/me/notification-prefs",
    minRole: "VIEWER",
    load: () => import("@/app/api/v1/me/notification-prefs/route"),
  },
  {
    method: "PUT",
    path: "/api/v1/me/notification-prefs",
    minRole: "VIEWER",
    load: () => import("@/app/api/v1/me/notification-prefs/route"),
    body: { enabled: true, sound: false, categories: ["DOWN"], alarmNames: [], sites: [] },
  },
  // G-T09
  { method: "GET", path: "/api/v1/alarms?status=active", minRole: "VIEWER", load: () => import("@/app/api/v1/alarms/route") },
  { method: "GET", path: "/api/v1/alarm-names", minRole: "VIEWER", load: () => import("@/app/api/v1/alarm-names/route") },
  // G-T10
  { method: "GET", path: "/api/v1/export?status=active", minRole: "VIEWER", load: () => import("@/app/api/v1/export/route") },
  { method: "GET", path: "/api/v1/stats/summary", minRole: "VIEWER", load: () => import("@/app/api/v1/stats/summary/route") },
  { method: "GET", path: "/api/v1/stats/daily", minRole: "VIEWER", load: () => import("@/app/api/v1/stats/daily/route") },
  { method: "GET", path: "/api/v1/stats/top-sites", minRole: "VIEWER", load: () => import("@/app/api/v1/stats/top-sites/route") },
  // G-T11
  { method: "GET", path: "/api/v1/settings/office", minRole: "ADMIN", load: () => import("@/app/api/v1/settings/office/route") },
  {
    method: "PUT",
    path: "/api/v1/settings/office",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/settings/office/route"),
    body: { office: "DN/Kafr ElDawar" },
  },
  { method: "GET", path: "/api/v1/settings/display", minRole: "ADMIN", load: () => import("@/app/api/v1/settings/display/route") },
  {
    method: "PUT",
    path: "/api/v1/settings/display",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/settings/display/route"),
    body: { categories: [], alarmNames: [] },
  },
  { method: "GET", path: "/api/v1/rules", minRole: "ADMIN", load: () => import("@/app/api/v1/rules/route") },
  { method: "PUT", path: "/api/v1/rules", minRole: "ADMIN", load: () => import("@/app/api/v1/rules/route"), body: { rules: [] } },
  { method: "POST", path: "/api/v1/reprocess", minRole: "ADMIN", load: () => import("@/app/api/v1/reprocess/route"), body: { days: 7 } },
  { method: "GET", path: "/api/v1/notifications", minRole: "VIEWER", load: () => import("@/app/api/v1/notifications/route") },
  { method: "POST", path: "/api/v1/notifications/read", minRole: "VIEWER", load: () => import("@/app/api/v1/notifications/read/route") },
  // G-T12 (OPERATOR downloads = processing, decided 2026-10-17)
  { method: "GET", path: "/api/v1/hourly-reports", minRole: "VIEWER", load: () => import("@/app/api/v1/hourly-reports/route") },
  {
    method: "GET",
    path: "/api/v1/hourly-reports/:id/attachment",
    minRole: "OPERATOR",
    load: () => import("@/app/api/v1/hourly-reports/[id]/attachment/route"),
    params: { id: "hourlynoatt00001" },
  },
  {
    method: "GET",
    path: "/api/v1/hourly-reports/:id/xlsx",
    minRole: "OPERATOR",
    load: () => import("@/app/api/v1/hourly-reports/[id]/xlsx/route"),
    params: { id: "hourlynoatt00001" },
  },
  // G-T15 (hourly-reference: OPERATOR, decided 2026-10-17)
  { method: "GET", path: "/api/v1/site-master", minRole: "VIEWER", load: () => import("@/app/api/v1/site-master/route") },
  { method: "POST", path: "/api/v1/site-master/import", minRole: "ADMIN", load: () => import("@/app/api/v1/site-master/import/route") },
  {
    method: "PUT",
    path: "/api/v1/site-master/:code",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/site-master/[code]/route"),
    params: { code: "0999DE" },
    body: { vip: true },
  },
  {
    method: "GET",
    path: "/api/v1/hourly-normalizations",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/hourly-normalizations/route"),
  },
  {
    method: "PUT",
    path: "/api/v1/hourly-normalizations",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/hourly-normalizations/route"),
    body: { rules: [] },
  },
  { method: "GET", path: "/api/v1/hourly-reference", minRole: "OPERATOR", load: () => import("@/app/api/v1/hourly-reference/route") },
  // P3-T07
  {
    method: "POST",
    path: "/api/v1/auth/tokens",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/auth/tokens/route"),
    body: { userId: 999999, name: "role-table" },
  },
  {
    method: "DELETE",
    path: "/api/v1/auth/tokens/:id",
    minRole: "ADMIN",
    load: () => import("@/app/api/v1/auth/tokens/[id]/route"),
    params: { id: "999999" },
  },
  // P7-T02 (mobile sign-in; POST /api/v1/auth/login is public)
  { method: "POST", path: "/api/v1/auth/logout", minRole: "VIEWER", load: () => import("@/app/api/v1/auth/logout/route") },
  // P3-T03
  { method: "GET", path: "/api/v1/openapi.json", minRole: "ADMIN", load: () => import("@/app/api/v1/openapi.json/route") },
];
