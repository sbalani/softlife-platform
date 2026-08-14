import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "@/lib/auth/session";
import { ymd } from "@/lib/dates";

type Session = Pick<SessionProfile, "role" | "tenant_id">;

export async function machineTenantAt(s: SupabaseClient, machineId: string, eventTime: string) {
  const day = ymd(new Date(eventTime));
  const [{ data: machine, error: machineError }, { data: assignment, error: assignmentError }] = await Promise.all([
    s.from("machines").select("tenant_id,deployed").eq("id", machineId).maybeSingle(),
    s.from("machine_franchisee_assignments").select("tenant_id").eq("machine_id", machineId)
      .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`)
      .order("start_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (machineError) throw machineError;
  if (assignmentError) throw assignmentError;
  if (!machine) throw new Error("Machine not found");
  if (!machine.deployed) return null;
  return (assignment?.tenant_id as string) ?? (machine.tenant_id as string) ?? null;
}

export async function canAccessMachine(s: SupabaseClient, session: Session, machineId: string, eventTime: string) {
  if (session.role === "admin") return true;
  const tenantId = await machineTenantAt(s, machineId, eventTime);
  return !!session.tenant_id && tenantId === session.tenant_id;
}

export async function accessibleMachineIds(s: SupabaseClient, session: Session, date = new Date()) {
  if (session.role === "admin") return null;
  if (!session.tenant_id) return [];
  const day = ymd(date);
  const [{ data: machines, error: machineError }, { data: assignments, error: assignmentError }] = await Promise.all([
    s.from("machines").select("id,tenant_id").eq("deployed", true),
    s.from("machine_franchisee_assignments").select("machine_id").eq("tenant_id", session.tenant_id)
      .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`),
  ]);
  if (machineError) throw machineError;
  if (assignmentError) throw assignmentError;
  const assigned = new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id));
  return ((machines as { id: string; tenant_id: string | null }[]) ?? [])
    .filter((machine) => machine.tenant_id === session.tenant_id || assigned.has(machine.id))
    .map((machine) => machine.id);
}
