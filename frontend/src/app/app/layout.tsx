"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell/AppShell";
import { AuthProvider } from "@/components/AuthProvider/AuthProvider";

/** Signed-in area: every page below requires a valid session. */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
