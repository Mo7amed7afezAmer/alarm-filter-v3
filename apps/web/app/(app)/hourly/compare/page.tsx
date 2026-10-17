import { HourlyCompare } from "@/components/hourly-compare";
import { hasRole } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

// FR-61.
export default async function ComparePage({ searchParams }: { searchParams: { a?: string; b?: string } }) {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "OPERATOR")) return <p role="alert">Comparing hourly reports needs the OPERATOR role.</p>;
  if (!searchParams.a || !searchParams.b) return <p role="alert">Choose two reports to compare.</p>;
  return <HourlyCompare previous={searchParams.a} current={searchParams.b} />;
}
