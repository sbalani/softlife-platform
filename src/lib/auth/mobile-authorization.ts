import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "./session.ts";
import { ymd } from "../dates.ts";

export type MobileCapability = "machines.read" | "service.refill" | "service.clean" | "alerts.read" | "recall.read" | "remote.basic";

export const MOBILE_CAPABILITIES: Record<SessionProfile["role"], MobileCapability[]> = {
  admin: ["machines.read", "service.refill", "service.clean", "alerts.read", "recall.read", "remote.basic"],
  operator: ["machines.read", "service.refill", "service.clean", "alerts.read", "recall.read"],
  franchisee: ["machines.read", "service.refill", "service.clean", "alerts.read", "recall.read", "remote.basic"],
};

export type MobileSession = {
  id: string;
  role: SessionProfile["role"];
  tenantId: string | null;
  employerKind: "softlife" | "franchisee" | "contractor";
  scopeVersion: number;
  capabilities: MobileCapability[];
};

export function normalizeMobileRole(value: unknown): SessionProfile["role"] {
  return value === "admin" || value === "franchisee" ? value : "operator";
}

export async function mobileUserProfile(s: SupabaseClient, user: { id: string; email?: string | null }) {
  const { data: profile, error } = await s.from("profiles")
    .select("role,tenant_id,employer_kind,scope_version,full_name,tenants(name)").eq("id", user.id).maybeSingle();
  if (error || !profile) throw error ?? new Error("User profile not found");
  const role = normalizeMobileRole(profile.role);
  const employerKind = ["softlife", "franchisee", "contractor"].includes(String(profile.employer_kind))
    ? profile.employer_kind as MobileSession["employerKind"] : "softlife";
  const tenant = profile.tenants as { name?: string } | null;
  return {
    uid: user.id,
    name: profile.full_name ?? user.email ?? "User",
    login: user.email ?? "",
    role,
    employer_kind: employerKind,
    employer_name: employerKind === "softlife" ? "SoftLife" : tenant?.name ?? null,
    tenant_id: (profile.tenant_id as string) ?? null,
    capabilities: MOBILE_CAPABILITIES[role],
    scope_version: Number(profile.scope_version ?? 1),
  };
}

export function hasMobileCapability(session: MobileSession, capability: MobileCapability) {
  return session.capabilities.includes(capability);
}

export async function mobileMachineIds(s: SupabaseClient, session: MobileSession, eventTime = new Date().toISOString()): Promise<string[] | null> {
  if (session.role === "admin") return null;
  const day = ymd(new Date(eventTime));
  if (session.role === "operator") {
    const { data, error } = await s.from("user_machine_assignments").select("machine_id")
      .eq("user_id", session.id).lte("starts_at", eventTime).or(`ends_at.is.null,ends_at.gte.${eventTime}`);
    if (error) throw error;
    return [...new Set(((data as { machine_id: string }[]) ?? []).map((row) => row.machine_id))];
  }
  if (!session.tenantId) return [];
  const [{ data: assignments, error: assignmentError }, { data: owned, error: ownedError }] = await Promise.all([
    s.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date")
      .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`).order("start_date", { ascending: false }),
    s.from("machines").select("id").eq("tenant_id", session.tenantId),
  ]);
  if (assignmentError) throw assignmentError;
  if (ownedError) throw ownedError;
  const effective = new Map<string, string>();
  for (const assignment of (assignments as { machine_id: string; tenant_id: string }[]) ?? []) {
    if (!effective.has(assignment.machine_id)) effective.set(assignment.machine_id, assignment.tenant_id);
  }
  return [...new Set([
    ...[...effective].filter(([, tenantId]) => tenantId === session.tenantId).map(([machineId]) => machineId),
    ...(((owned as { id: string }[]) ?? []).filter((row) => !effective.has(row.id)).map((row) => row.id)),
  ])];
}

export async function canAccessMobileMachine(s: SupabaseClient, session: MobileSession, machineId: string, eventTime: string) {
  const ids = await mobileMachineIds(s, session, eventTime);
  return ids === null || ids.includes(machineId);
}
