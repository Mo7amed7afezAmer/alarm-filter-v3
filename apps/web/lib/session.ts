import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import type { SessionUser } from "./roles";

/** The signed-in user of the current request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as Partial<SessionUser> | undefined;
  if (!user?.id || !user.role || !user.email) return null;
  return { id: Number(user.id), email: user.email, role: user.role };
}
