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
  let query = service
    .from("machines")
    .select("id,name,display_name,device_imei,is_online")
    .not("device_imei", "is", null)
    .order("display_name", { ascending: true, nullsFirst: false });

  if (session.role === "franchisee") {
    if (!session.tenant_id) return [];
    query = query.eq("customer_id", session.tenant_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as AccessibleMachine[]) ?? [];
}
