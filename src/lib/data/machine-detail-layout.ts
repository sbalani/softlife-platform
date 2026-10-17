import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeMachineDetailWidgetOrder } from "@/lib/machine-detail-layout";

export async function getMachineDetailWidgetOrder() {
  if (!isSupabaseConfigured()) return { widgetOrder: normalizeMachineDetailWidgetOrder(null), updatedAt: null };
  const { data, error } = await (await createServiceClient())
    .from("machine_detail_settings")
    .select("widget_order,updated_at")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  return {
    widgetOrder: normalizeMachineDetailWidgetOrder(data?.widget_order),
    updatedAt: data?.updated_at ?? null,
  };
}
