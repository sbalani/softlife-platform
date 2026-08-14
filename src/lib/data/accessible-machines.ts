import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type AccessibleMachine = {
  id: string;
  name: string;
  display_name: string | null;
  device_imei: string;
  is_online: boolean | null;
};

export async function getAccessibleMachineIds(): Promise<string[] | null> {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") return [];
  if (session.role === "admin") return null;
  if (!session.tenant_id) return [];

  const service = await createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: assignments, error } = await service
    .from("machine_franchisee_assignments")
    .select("machine_id")
    .eq("tenant_id", session.tenant_id)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (error) throw new Error(error.message);
  const assignedIds = [...new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id))];
  if (!assignedIds.length) return [];
  const { data: deployed, error: machineError } = await service.from("machines").select("id").in("id", assignedIds).eq("deployed", true);
  if (machineError) throw new Error(machineError.message);
  return ((deployed as { id: string }[]) ?? []).map((row) => row.id);
}

export async function getAccessibleMachines(): Promise<AccessibleMachine[]> {
  const assignedMachineIds = await getAccessibleMachineIds();
  if (assignedMachineIds?.length === 0) return [];

  const service = await createServiceClient();
  let query = service
    .from("machines")
    .select("id,name,display_name,device_imei,is_online")
    .not("device_imei", "is", null)
    .order("display_name", { ascending: true, nullsFirst: false });

  if (assignedMachineIds !== null) query = query.in("id", assignedMachineIds);
  if (assignedMachineIds !== null) query = query.eq("deployed", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as AccessibleMachine[]) ?? [];
}
