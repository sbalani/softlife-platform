import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { translateLocation } from "@/lib/i18n/huaxin";
import type { Source } from "./machines";

export type ProductOpt = { id: string; name: string; type: string };

export type MachineConfig = {
  machineId: string | null;
  name: string;
  location: string | null;
  locationOverride: string | null;
  latitude: number | null;
  longitude: number | null;
  baseProductId: string | null;
  profile: string | null;
  lastFullClean: string | null;
  paymentModel: string | null;
  customerId: string | null;
  nayaxId: string | null;
  displayName: string | null;
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
      .select("id,name,location,location_override,latitude,longitude,base_product_id,profile,last_full_clean_date,payment_model,customer_id,nayax_id,display_name,created_at")
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
      location: (machine?.location_override as string) || translateLocation(machine?.location as string) || null,
      locationOverride: (machine?.location_override as string) ?? null,
      latitude: (machine?.latitude as number) ?? null,
      longitude: (machine?.longitude as number) ?? null,
      baseProductId: (machine?.base_product_id as string) ?? null,
      profile: (machine?.profile as string) ?? null,
      lastFullClean: (machine?.last_full_clean_date as string) ?? null,
      paymentModel: (machine?.payment_model as string) ?? null,
      customerId: (machine?.customer_id as string) ?? null,
      nayaxId: (machine?.nayax_id as string) ?? null,
      displayName: (machine?.display_name as string) ?? null,
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
