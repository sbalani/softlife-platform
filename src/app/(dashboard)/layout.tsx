import type { ReactNode } from "react";
import { getSessionProfile } from "@/lib/auth/session";
import { DashboardShell } from "./DashboardShell";
import { createServiceClient } from "@/lib/supabase/server";
import { latestBuildUpdateForUser } from "@/lib/mobile-builds";
import { getPayoutReadiness } from "@/lib/data/franchisees";
import { getRequestLocale } from "@/lib/i18n/request-locale";

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
  const [locale, buildResult, payoutReadiness] = await Promise.all([
    getRequestLocale(),
    session ? latestBuildUpdateForUser(await createServiceClient(), session.id).catch((error) => { console.error("[mobile-build] Could not load update alert:", error); return null; }) : null,
    session?.role === "franchisee" && session.tenant_id ? getPayoutReadiness(session.tenant_id).catch((error) => { console.error("[payout-readiness] Could not load status:", error); return null; }) : null,
  ]);
  const mobileBuildUpdate = buildResult ? { id: buildResult.id, version: buildResult.version, buildNumber: buildResult.build_number } : null;

  return <DashboardShell profile={profile} mobileBuildUpdate={mobileBuildUpdate} payoutMissing={payoutReadiness && !payoutReadiness.ready ? [...payoutReadiness.missing] : []} locale={locale}>{children}</DashboardShell>;
}
