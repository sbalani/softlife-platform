import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getTenants } from "./franchisees";

export type Lot = {
  id: string;
  name: string;
  product_name: string | null;
  qty_available: number;
  disposition: string;
  device_event_time: string | null;
  tenant_name: string | null;
};

export async function getLots(): Promise<Lot[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("lots")
      .select("id, name, product_name, qty_available, disposition, device_event_time, tenant_id")
      .order("device_event_time", { ascending: false, nullsFirst: false });
    const tenants = await getTenants();
    const byId = new Map(tenants.map((t) => [t.id, t.name]));
    return ((data as Record<string, unknown>[]) ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      product_name: (l.product_name as string) ?? null,
      qty_available: Number(l.qty_available ?? 0),
      disposition: (l.disposition as string) ?? "released",
      device_event_time: (l.device_event_time as string) ?? null,
      tenant_name: l.tenant_id ? (byId.get(l.tenant_id as string) ?? null) : null,
    }));
  } catch {
    return [];
  }
}
