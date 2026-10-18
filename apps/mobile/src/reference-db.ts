// P7-T05: the on-device reference database (expo-sqlite); kept across sign-outs so hourly reports
// keep working offline after the first sync.
import * as SQLite from "expo-sqlite";
import { sqliteReferenceStore, type ReferenceStore } from "./reference";

export const REFERENCE_DB = "noc-reference.db";

export const referenceStore = (): ReferenceStore => sqliteReferenceStore(() => SQLite.openDatabaseAsync(REFERENCE_DB));
