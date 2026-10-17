import { Suspense } from "react";
import { HourlyReport } from "@/components/hourly-report";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export default async function HourlyReportPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "OPERATOR")) {
    return <p role="alert">Processing hourly reports needs the OPERATOR role.</p>;
  }
  return (
    <Suspense>
      <HourlyReport id={params.id} />
    </Suspense>
  );
}
