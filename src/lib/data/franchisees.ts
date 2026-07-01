import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  name: string;
  kind: string;
  created_at: string;
};

export async function getTenants(): Promise<Tenant[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("tenants")
      .select("id, name, kind, created_at")
      .order("name");
    return (data as Tenant[]) ?? [];
  } catch {
    return [];
  }
}
