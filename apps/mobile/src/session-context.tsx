import { router } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient } from "./api";
import { sweepReportFiles } from "./files";
import { nativeFiles } from "./files-native";
import { HourlyReports, nextFrame } from "./hourly";
import { ReferenceSync } from "./reference";
import { referenceStore } from "./reference-db";
import { SessionStore } from "./session";
import type { Session } from "./storage";

interface SessionValue {
  store: SessionStore;
  api: ApiClient;
  /** Opened hourly reports, in memory only; cleared on every sign-out (P7-T06). */
  reports: HourlyReports;
  session: Session | null;
  ready: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Callbacks run on every sign-out (e.g. dropping in-memory reports, P7-T06). */
export const signOutHandlers = new Set<() => void>();

/** P7-T02: one session for the app; any sign-out (logout or 401) returns to the login screen. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useMemo(
    () =>
      new SessionStore({
        onSignedOut: () => {
          for (const fn of signOutHandlers) fn();
          router.replace("/login");
        },
      }),
    [],
  );
  const api = useMemo(() => new ApiClient(store), [store]);
  const reports = useMemo(() => {
    const reference = new ReferenceSync(api, referenceStore());
    return new HourlyReports(api, nextFrame, () => reference.load());
  }, [api]);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // P7-T06: sign-out drops the in-memory reports and any report file left in the cache directory.
    const clear = () => {
      reports.clear();
      void sweepReportFiles(nativeFiles).catch(() => undefined);
    };
    void sweepReportFiles(nativeFiles).catch(() => undefined);
    signOutHandlers.add(clear);
    return () => {
      signOutHandlers.delete(clear);
    };
  }, [reports]);

  useEffect(() => {
    const off = store.subscribe(setSession);
    void store.restore().finally(() => setReady(true));
    return () => {
      off();
    };
  }, [store]);

  return <SessionContext.Provider value={{ store, api, reports, session, ready }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
