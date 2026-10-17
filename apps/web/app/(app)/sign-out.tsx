"use client";

import { signOut } from "next-auth/react";
import { clearReports } from "@/lib/hourly/processor";

export function SignOut() {
  return (
    <button type="button" onClick={() => {
        // G-T14: processed hourly reports are cleared on logout.
        clearReports();
        void signOut({ callbackUrl: "/login" });
      }}>
      Sign out
    </button>
  );
}
