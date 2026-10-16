import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/session";
import { SignOut } from "./sign-out";

// FR-26: every page in the app needs a session.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <>
      <header className="shell">
        <strong>NOC Alarm Platform</strong>
        <nav className="links">
          <Link href="/alarms">Alarms</Link>
          <Link href="/cleared">Cleared</Link>
        </nav>
        <span className="who">
          {user.email} · {user.role}
        </span>
        <SignOut />
      </header>
      <main>{children}</main>
    </>
  );
}
