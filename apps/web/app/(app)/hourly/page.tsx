import { HourlyList } from "@/components/hourly-list";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

// FR-47 / FR-64: OPERATOR and ADMIN may process reports (decided 2026-10-17).
export default async function HourlyPage() {
  const user = await getSessionUser();
  return <HourlyList canProcess={!!user && hasRole(user.role, "OPERATOR")} />;
}
