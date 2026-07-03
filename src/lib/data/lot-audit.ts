import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type LotUsage = {
  id: string;
  machine_name: string | null;
  device_imei: string | null;
  product_name: string | null;
  product_type: string;
  lot_name: string;
  position: string | null;
  quantity: number | null;
  device_event_time: string;
};

export async function getLotUsages(filters: {
  dateFrom?: string;
  dateTo?: string;
  machine?: string;
  productType?: string;
  lotName?: string;
}): Promise<LotUsage[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    let q = s.from("lot_usages").select("*").order("device_event_time", { ascending: false }).limit(200);
    if (filters.dateFrom) q = q.gte("device_event_time", filters.dateFrom);
    if (filters.dateTo) q = q.lte("device_event_time", filters.dateTo + "T23:59:59");
    if (filters.machine) q = q.or(`machine_name.ilike.%${filters.machine}%,device_imei.ilike.%${filters.machine}%`);
    if (filters.productType) q = q.eq("product_type", filters.productType);
    if (filters.lotName) q = q.ilike("lot_name", `%${filters.lotName}%`);
    const { data } = await q;
    return (data as LotUsage[]) ?? [];
  } catch {
    return [];
  }
}

export async function getMachineLotHistory(imei: string): Promise<LotUsage[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("lot_usages")
      .select("*")
      .eq("device_imei", imei)
      .order("device_event_time", { ascending: false })
      .limit(20);
    return (data as LotUsage[]) ?? [];
  } catch {
    return [];
  }
}
