import type { ReactNode } from "react";
import { getSessionProfile } from "@/lib/auth/session";
import { DashboardShell } from "./DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Middleware guarantees a session exists for every route this layout wraps;
  // the null fallback here is just so a race/edge case renders a safe default
  // instead of crashing, not a substitute for the middleware check.
  const session = await getSessionProfile();
  const profile = {
    role: session?.role ?? "operator",
    email: session?.email ?? null,
    fullName: session?.full_name ?? null,
  } as const;

  return <DashboardShell profile={profile}>{children}</DashboardShell>;
}
