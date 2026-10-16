"use client";

import { signOut } from "next-auth/react";

export function SignOut() {
  return (
    <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
