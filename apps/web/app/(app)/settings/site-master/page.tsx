import { redirect } from "next/navigation";
import { SiteMasterSettings } from "@/components/site-master-settings";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

// FR-67 / G-T15: ADMIN only, checked on the server; GET /api/v1/site-master stays readable by any user.
export default async function SiteMasterPage() {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "ADMIN")) redirect("/alarms");
  return <SiteMasterSettings />;
}
