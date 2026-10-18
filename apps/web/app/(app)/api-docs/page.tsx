import { redirect } from "next/navigation";
import { ApiDocs } from "@/components/api-docs";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

// P3-T03: Swagger UI for /api/v1/openapi.json, ADMIN only, checked on the server.
export default async function ApiDocsPage() {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "ADMIN")) redirect("/alarms");
  return <ApiDocs />;
}
