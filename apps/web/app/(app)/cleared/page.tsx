import { AlarmList } from "@/components/alarm-list";
import { alertHoursFrom } from "@/lib/alarm-ui";

// FR-31 / FR-34: cleared alarms with duration and Site Master columns.
export const dynamic = "force-dynamic";

export default function ClearedPage() {
  return <AlarmList status="cleared" alertHours={alertHoursFrom(process.env.ALERT_HOURS)} />;
}
