import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductAllergen = { id: string; name: string; slug: string; logo_url: string | null };

export type Product = {
  id: string;
  name: string;
  type: string;
  sku: string | null;
  description: string | null;
  brand: string | null;
  ingredients_list: string | null;
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
  allergens: { contains: ProductAllergen[]; may_contain: ProductAllergen[] };
};

export async function getProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("products")
      .select("*, ingredient_allergens(presence, allergens(id,name,slug,logo_url))")
      .order("name");
    return ((data as Record<string, unknown>[]) ?? []).map((p) => {
      const ia = (p.ingredient_allergens as { presence: string; allergens: ProductAllergen }[]) ?? [];
      return {
        id: p.id as string,
        name: p.name as string,
        type: p.type as string,
        sku: (p.sku as string) ?? null,
        description: (p.description as string) ?? null,
        brand: (p.brand as string) ?? null,
        ingredients_list: (p.ingredients_list as string) ?? null,
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
        allergens: {
          contains: ia.filter((x) => x.presence === "contains").map((x) => x.allergens),
          may_contain: ia.filter((x) => x.presence === "may_contain").map((x) => x.allergens),
        },
      };
    });
  } catch {
    return [];
  }
}
