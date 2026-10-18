// FR-27 on the device: VIEWER < OPERATOR < ADMIN. Admin screens stay web-only (Phase 7 scope); the
// server still checks every request.
export type Role = "VIEWER" | "OPERATOR" | "ADMIN";

const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export const hasRole = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

export type EntryPoint = "alarms" | "cleared" | "hourly";

/** Tab-bar screens and their minimum role; admin screens are not in the app at all. */
const ENTRY_POINTS: { name: EntryPoint; minRole: Role }[] = [
  { name: "alarms", minRole: "VIEWER" },
  { name: "cleared", minRole: "VIEWER" },
  { name: "hourly", minRole: "VIEWER" },
];

/** The screens a role reaches from the tab bar. */
export const entryPointsFor = (role: Role): EntryPoint[] => ENTRY_POINTS.filter((e) => hasRole(role, e.minRole)).map((e) => e.name);

/** Opening a report downloads it (`…/xlsx`), which is OPERATOR on the server (G-T12). */
export const canOpenHourlyReports = (role: Role): boolean => hasRole(role, "OPERATOR");
