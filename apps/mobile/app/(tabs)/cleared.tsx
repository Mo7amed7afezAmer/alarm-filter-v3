import { AlarmListScreen } from "../../src/alarm-list-screen";

/** P7-T03: cleared alarms (FR-31). */
export default function ClearedScreen() {
  return <AlarmListScreen status="cleared" />;
}
