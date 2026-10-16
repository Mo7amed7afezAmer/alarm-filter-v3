import { z } from "zod";
import { ROLES } from "./roles";

/** FR-28 / NFR-19. */
export const BCRYPT_ROUNDS = 12;
export const password = z.string().min(8).max(200);
export const role = z.enum(ROLES as unknown as ["VIEWER", "OPERATOR", "ADMIN"]);
export const userId = z.object({ id: z.coerce.number().int().positive() });

export const publicUser = { id: true, email: true, role: true } as const;
