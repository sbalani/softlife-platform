import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type CleanLog = {
  id: string;
  kind: string;
  device_event_time: string;
  operator_name: string | null;
};

export async function recordMachineClean(s: SupabaseClient, values: {
  machineId: string;
  clientUuid: string;
  operatorId: string | null;
  kind: "full" | "partial";
  eventTime: string;
}) {
  const { data, error } = await s.rpc("record_machine_clean", {
    p_machine_id: values.machineId,
    p_client_uuid: values.clientUuid,
    p_operator_id: values.operatorId,
    p_kind: values.kind,
    p_device_event_time: values.eventTime,
  });
  if (error) throw error;
  return data as string | null;
}

export async function getMachineCleanHistory(machineId: string): Promise<CleanLog[]> {
  if (!isSupabaseConfigured()) return [];
  const s = await createServiceClient();
  const { data, error } = await s.from("clean_logs")
    .select("id,kind,device_event_time,profiles(full_name,email)")
    .eq("machine_id", machineId)
    .order("device_event_time", { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const operator = row.profiles as { full_name?: string; email?: string } | null;
    return {
      id: row.id as string,
      kind: row.kind as string,
      device_event_time: row.device_event_time as string,
      operator_name: operator?.full_name ?? operator?.email ?? null,
    };
  });
}
