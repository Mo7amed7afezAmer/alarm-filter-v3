/** FR-27: VIEWER < OPERATOR < ADMIN. */
export type Role = "VIEWER" | "OPERATOR" | "ADMIN";

export const ROLES: readonly Role[] = ["VIEWER", "OPERATOR", "ADMIN"];

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function hasRole(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}
