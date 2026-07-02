import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getTenants } from "./franchisees";

export type Product = {
  id: string;
  name: string;
  type: string;
  tenant_name: string | null;
  sku: string | null;
  description: string | null;
  brand: string | null;
  ingredients_list: string | null;
  allergens_contains: string[] | null;
  allergens_may_contain: string[] | null;
  country_of_origin: string | null;
  nutritional_claim: string | null;
  nf_calories: number | null;
  nf_protein: number | null;
  nf_carbs: number | null;
  nf_sugar: number | null;
  nf_fat: number | null;
  default_portion_size: number | null;
  cost_per_kg: number | null;
  price: number;
  image_url: string | null;
  allergen_url: string | null;
};

const COLS =
  "id,name,type,tenant_id,sku,description,brand,ingredients_list,allergens_contains,allergens_may_contain,country_of_origin,nutritional_claim,nf_calories,nf_protein,nf_carbs,nf_sugar,nf_fat,default_portion_size,cost_per_kg,price,image_url,allergen_url";

export async function getProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s.from("products").select(COLS).order("name");
    const tenants = await getTenants();
    const byId = new Map(tenants.map((t) => [t.id, t.name]));
    return ((data as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      type: p.type as string,
      tenant_name: p.tenant_id ? (byId.get(p.tenant_id as string) ?? null) : null,
      sku: (p.sku as string) ?? null,
      description: (p.description as string) ?? null,
      brand: (p.brand as string) ?? null,
      ingredients_list: (p.ingredients_list as string) ?? null,
      allergens_contains: (p.allergens_contains as string[]) ?? null,
      allergens_may_contain: (p.allergens_may_contain as string[]) ?? null,
      country_of_origin: (p.country_of_origin as string) ?? null,
      nutritional_claim: (p.nutritional_claim as string) ?? null,
      nf_calories: (p.nf_calories as number) ?? null,
      nf_protein: (p.nf_protein as number) ?? null,
      nf_carbs: (p.nf_carbs as number) ?? null,
      nf_sugar: (p.nf_sugar as number) ?? null,
      nf_fat: (p.nf_fat as number) ?? null,
      default_portion_size: (p.default_portion_size as number) ?? null,
      cost_per_kg: (p.cost_per_kg as number) ?? null,
      price: Number(p.price ?? 0),
      image_url: (p.image_url as string) ?? null,
      allergen_url: (p.allergen_url as string) ?? null,
    }));
  } catch {
    return [];
  }
}
