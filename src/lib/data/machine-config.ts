import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Source } from "./machines";

export type ProductOpt = { id: string; name: string; type: string };

export type MachineConfig = {
  machineId: string | null;
  name: string;
  location: string | null;
  baseProductId: string | null;
  profile: string | null;
  lastFullClean: string | null;
  ingredients: { position: string; product_id: string | null; product_type: string; current_lot_name: string | null; last_loaded_date: string | null }[];
  bases: ProductOpt[];
  toppings: ProductOpt[];
  sauces: ProductOpt[];
  source: Source;
};

export const PROFILE_SLOTS: Record<string, { solid: number; liquid: number }> = {
  "3+3": { solid: 3, liquid: 3 },
  manual: { solid: 0, liquid: 0 },
};

export async function getMachineConfig(imei: string): Promise<MachineConfig | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const s = await createServiceClient();
    const { data: m } = await s
      .from("machines")
      .select("id,name,location,base_product_id,profile,last_full_clean_date")
      .eq("device_imei", imei)
      .maybeSingle();
    const machine = m as Record<string, unknown> | null;

    const { data: prods } = await s.from("products").select("id,name,type").order("name");
    const products = (prods as ProductOpt[]) ?? [];

    let ingredients: MachineConfig["ingredients"] = [];
    if (machine?.id) {
      const { data: ings } = await s
        .from("machine_ingredients")
        .select("position,product_id,product_type,current_lot_name,last_loaded_date")
        .eq("machine_id", machine.id as string);
      ingredients = (ings as MachineConfig["ingredients"]) ?? [];
    }

    return {
      machineId: (machine?.id as string) ?? null,
      name: (machine?.name as string) ?? imei,
      location: (machine?.location as string) ?? null,
      baseProductId: (machine?.base_product_id as string) ?? null,
      profile: (machine?.profile as string) ?? null,
      lastFullClean: (machine?.last_full_clean_date as string) ?? null,
      ingredients,
      bases: products.filter((p) => p.type === "base"),
      toppings: products.filter((p) => p.type === "topping"),
      sauces: products.filter((p) => p.type === "sauce"),
      source: "supabase",
    };
  } catch {
    return null;
  }
}
