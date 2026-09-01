import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "./session.ts";
import { ymd } from "../dates.ts";

export type MobileCapability = "machines.read" | "analytics.read" | "service.refill" | "service.clean" | "action_reports.write" | "action_reports.attach" | "alerts.read" | "recall.read" | "remote.basic" | "defrost.run";

export const MOBILE_CAPABILITIES: Record<SessionProfile["role"], MobileCapability[]> = {
  admin: ["machines.read", "analytics.read", "service.refill", "service.clean", "action_reports.write", "action_reports.attach", "alerts.read", "recall.read", "remote.basic", "defrost.run"],
  operator: ["machines.read", "analytics.read", "service.refill", "service.clean", "action_reports.write", "action_reports.attach", "alerts.read", "recall.read"],
  franchisee: ["machines.read", "analytics.read", "service.refill", "service.clean", "action_reports.write", "action_reports.attach", "alerts.read", "recall.read", "remote.basic"],
};

export type MobileSession = {
  id: string;
  email: string | null;
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

export function canDismissMobileAlert(session: MobileSession) {
  return hasMobileCapability(session, "alerts.read") && (session.role === "admin" || session.role === "franchisee");
}

export function canReceiveMobileAlert(role: MobileSession["role"], machineIds: string[] | null | undefined, machineId: string | null) {
  if (!machineId) return role === "admin";
  return machineIds === null || machineIds?.includes(machineId) === true;
}

export async function mobileMachineIds(s: SupabaseClient, session: MobileSession, eventTime = new Date().toISOString()): Promise<string[] | null> {
  if (session.role === "admin") return null;
  const day = ymd(new Date(eventTime));
  if (session.role === "operator") {
    const { data, error } = await s.from("user_machine_assignments").select("machine_id")
      .eq("user_id", session.id).lte("starts_at", eventTime).or(`ends_at.is.null,ends_at.gte.${eventTime}`);
    if (error) throw error;
    const ids = [...new Set(((data as { machine_id: string }[]) ?? []).map((row) => row.machine_id))];
    if (!ids.length) return [];
    const { data: machines, error: machineError } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
    if (machineError) throw machineError;
    return ((machines as { id: string }[]) ?? []).map((row) => row.id);
  }
  if (!session.tenantId) return [];
  const { data: assignments, error: assignmentError } = await s.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date")
    .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`).order("start_date", { ascending: false });
  if (assignmentError) throw assignmentError;
  const effective = new Map<string, string>();
  for (const assignment of (assignments as { machine_id: string; tenant_id: string }[]) ?? []) {
    if (!effective.has(assignment.machine_id)) effective.set(assignment.machine_id, assignment.tenant_id);
  }
  const ids = [...effective].filter(([, tenantId]) => tenantId === session.tenantId).map(([machineId]) => machineId);
  if (!ids.length) return [];
  const { data: machines, error: machineError } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
  if (machineError) throw machineError;
  return ((machines as { id: string }[]) ?? []).map((row) => row.id);
}

export async function canAccessMobileMachine(s: SupabaseClient, session: MobileSession, machineId: string, eventTime: string) {
  const ids = await mobileMachineIds(s, session, eventTime);
  return ids === null || ids.includes(machineId);
}
