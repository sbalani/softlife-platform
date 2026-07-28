import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type AccessibleMachine = {
  id: string;
  name: string;
  display_name: string | null;
  device_imei: string;
  is_online: boolean | null;
};

export async function getAccessibleMachines(): Promise<AccessibleMachine[]> {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") return [];

  const service = await createServiceClient();
  let assignedMachineIds: string[] | null = null;
  if (session.role === "franchisee") {
    if (!session.tenant_id) return [];
    const today = new Date().toISOString().slice(0, 10);
    const { data: assignments, error } = await service
      .from("machine_franchisee_assignments")
      .select("machine_id")
      .eq("tenant_id", session.tenant_id)
      .lte("start_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`);
    if (error) return [];
    assignedMachineIds = [...new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id))];
    if (!assignedMachineIds.length) return [];
  }

  let query = service
    .from("machines")
    .select("id,name,display_name,device_imei,is_online")
    .not("device_imei", "is", null)
    .order("display_name", { ascending: true, nullsFirst: false });

  if (assignedMachineIds) query = query.in("id", assignedMachineIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as AccessibleMachine[]) ?? [];
}
