import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { NotificationBell } from "@/components/notification-bell";
import { hasRole } from "@/lib/roles";
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
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/hourly">Hourly</Link>
          <Link href="/me">My settings</Link>
          {hasRole(user.role, "ADMIN") && <Link href="/settings">Settings</Link>}
        </nav>
        <span className="who">
          {user.email} · {user.role}
        </span>
        <NotificationBell />
        <SignOut />
      </header>
      <main>{children}</main>
    </>
  );
}
