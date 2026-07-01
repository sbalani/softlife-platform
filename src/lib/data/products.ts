import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getTenants } from "./franchisees";

export type Product = {
  id: string;
  name: string;
  type: string;
  tenant_name: string | null;
};

export async function getProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("products")
      .select("id, name, type, tenant_id")
      .order("name");
    const tenants = await getTenants();
    const byId = new Map(tenants.map((t) => [t.id, t.name]));
    return ((data as { id: string; name: string; type: string; tenant_id: string | null }[]) ?? []).map(
      (p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        tenant_name: p.tenant_id ? (byId.get(p.tenant_id) ?? null) : null,
      }),
    );
  } catch {
    return [];
  }
}
