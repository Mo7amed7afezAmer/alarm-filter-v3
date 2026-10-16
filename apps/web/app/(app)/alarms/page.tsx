import { AlarmList } from "@/components/alarm-list";
import { alertHoursFrom } from "@/lib/alarm-ui";

// FR-33: active alarms, newest first, live ages, highlighted after ALERT_HOURS.
export const dynamic = "force-dynamic";

export default function AlarmsPage() {
  return <AlarmList status="active" alertHours={alertHoursFrom(process.env.ALERT_HOURS)} />;
}
