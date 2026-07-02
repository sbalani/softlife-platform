import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getTenants } from "./franchisees";

export type Product = {
  id: string;
  name: string;
  type: string;
  tenant_name: string | null;
  price: number;
  image_url: string | null;
  allergen_url: string | null;
};

export async function getProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("products")
      .select("id,name,type,tenant_id,price,image_url,allergen_url")
      .order("name");
    const tenants = await getTenants();
    const byId = new Map(tenants.map((t) => [t.id, t.name]));
    return ((data as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      type: p.type as string,
      tenant_name: p.tenant_id ? (byId.get(p.tenant_id as string) ?? null) : null,
      price: Number(p.price ?? 0),
      image_url: (p.image_url as string) ?? null,
      allergen_url: (p.allergen_url as string) ?? null,
    }));
  } catch {
    return [];
  }
}
