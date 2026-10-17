import { createUser, freshDatabase } from "../test/db";
import { seedAlarms } from "../test/fixtures";

/** Test login for the smoke tests (alarms_test only). */
export const E2E_USER = { email: "e2e-viewer@noc.test", password: "e2e-password-123" };
export const E2E_OPERATOR = { email: "e2e-operator@noc.test", password: "e2e-password-123" };

// Fresh alarms_test with the samples/alarms fixture and one VIEWER.
export default async function globalSetup(): Promise<void> {
  const db = await freshDatabase();
  try {
    await seedAlarms(db);
    await db.systemStatus.create({ data: { id: 1, officeLabel: "DN/Kafr ElDawar" } });
    await createUser(db, E2E_USER.email, "VIEWER", E2E_USER.password);
    await createUser(db, E2E_OPERATOR.email, "OPERATOR", E2E_OPERATOR.password);
  } finally {
    await db.$disconnect();
  }
}
