import { redirect } from "next/navigation";
import { AdminSettings } from "@/components/admin-settings";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

// ADMIN only, checked on the server (NFR-18).
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "ADMIN")) redirect("/alarms");
  return <AdminSettings />;
}
