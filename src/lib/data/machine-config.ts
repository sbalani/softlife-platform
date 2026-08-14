import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { translateLocation } from "@/lib/i18n/huaxin";
import type { Source } from "./machines";

export type ProductOpt = { id: string; name: string; type: string };
export type OdooWarehouseOpt = { odoo_id: number; name: string; code: string | null };

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
  odooWarehouseId: number | null;
  deployed: boolean;
  defrostSchedule: { enabled: boolean; localStartTime: string; defrostMinutes: number; requiresIntervention: boolean } | null;
  latestDefrostRun: { state: string; scheduledFor: string; lastFormationPct: number | null; failureDetail: string | null } | null;
  odooWarehouses: OdooWarehouseOpt[];
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
      .select("id,name,location,location_override,latitude,longitude,base_product_id,profile,last_full_clean_date,payment_model,customer_id,nayax_id,display_name,odoo_warehouse_id,deployed,created_at")
      .eq("device_imei", imei)
      .maybeSingle();
    const machine = m as Record<string, unknown> | null;

    const { data: prods } = await s.from("products").select("id,name,type").order("name");
    const products = (prods as ProductOpt[]) ?? [];
    const { data: warehouseRows, error: warehouseError } = await s.from("odoo_warehouses").select("odoo_id,name,code").order("name");
    if (warehouseError) throw warehouseError;

    let ingredients: MachineConfig["ingredients"] = [];
    let defrostSchedule: MachineConfig["defrostSchedule"] = null;
    let latestDefrostRun: MachineConfig["latestDefrostRun"] = null;
    if (machine?.id) {
      const [ingredientResult, scheduleResult, runResult] = await Promise.all([
        s.from("machine_ingredients").select("position,product_id,product_type,current_lot_name,last_loaded_date").eq("machine_id", machine.id as string),
        s.from("machine_defrost_schedules").select("enabled,local_start_time,defrost_seconds,requires_intervention").eq("machine_id", machine.id as string).maybeSingle(),
        s.from("machine_defrost_runs").select("state,scheduled_for,last_formation_pct,failure_detail").eq("machine_id", machine.id as string).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (ingredientResult.error) throw ingredientResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (runResult.error) throw runResult.error;
      const { data: ings } = ingredientResult;
      const { data: schedule } = scheduleResult;
      const { data: run } = runResult;
      ingredients = (ings as MachineConfig["ingredients"]) ?? [];
      if (schedule) defrostSchedule = { enabled: Boolean(schedule.enabled), localStartTime: String(schedule.local_start_time).slice(0, 5), defrostMinutes: Number(schedule.defrost_seconds) / 60, requiresIntervention: Boolean(schedule.requires_intervention) };
      if (run) latestDefrostRun = { state: String(run.state), scheduledFor: String(run.scheduled_for), lastFormationPct: run.last_formation_pct == null ? null : Number(run.last_formation_pct), failureDetail: (run.failure_detail as string) ?? null };
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
      odooWarehouseId: (machine?.odoo_warehouse_id as number) ?? null,
      deployed: machine?.deployed !== false,
      defrostSchedule,
      latestDefrostRun,
      odooWarehouses: (warehouseRows as OdooWarehouseOpt[]) ?? [],
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
