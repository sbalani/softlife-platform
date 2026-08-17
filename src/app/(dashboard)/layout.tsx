import type { ReactNode } from "react";
import { getSessionProfile } from "@/lib/auth/session";
import { DashboardShell } from "./DashboardShell";
import { createServiceClient } from "@/lib/supabase/server";
import { latestBuildUpdateForUser } from "@/lib/mobile-builds";

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
  let mobileBuildUpdate = null;
  if (session) {
    try {
      const build = await latestBuildUpdateForUser(await createServiceClient(), session.id);
      if (build) mobileBuildUpdate = { id: build.id, version: build.version, buildNumber: build.build_number };
    } catch (error) {
      console.error("[mobile-build] Could not load update alert:", error);
    }
  }

  return <DashboardShell profile={profile} mobileBuildUpdate={mobileBuildUpdate}>{children}</DashboardShell>;
}
