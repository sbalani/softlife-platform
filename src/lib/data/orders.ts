import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { ymd as localYmd } from "@/lib/dates";
import { storedOrderFromRow } from "@/lib/data/order-persistence";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderProduct = { goodsName: string; price: string; position: number };

export type Order = {
  id: string;
  order_time: string;
  machine_name: string | null;
  device_imei: string | null;
  order_code: string;
  out_trade_no: string | null;
  order_state: string;
  status_code: string;
  price: number;
  market_price: number | null;
  discount_price: number | null;
  re_price: number | null;
  product_name: string;
  products: OrderProduct[];
  nums: number;
  amount: number;
  pay_type_raw: string | null;
  pay_type: string | null;
  is_server_mode: boolean;
  is_admin_override: boolean;
  machine_collected: number;
  franchisee_owed: number;
  pay_time: string | null;
  create_time_utc: string | null;
  refund_status: string | null;
  refund_out_no: string | null;
  coupon_used: boolean;
  activity_name: string | null;
  device_label: string | null;
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function shiftDay(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function orderFromSupabaseRow(row: Record<string, unknown>): Order {
  return storedOrderFromRow(row) as Order;
}

export type OrderSyncSummary = {
  status: string;
  requestedFrom: string;
  requestedTo: string;
  finishedAt: string | null;
  failedMachines: number;
};

export async function getOrders(filters?: {
  machine?: string;
  minPrice?: number;
  maxPrice?: number;
  couponOnly?: boolean;
  refundedOnly?: boolean;
  serverModeOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  timeZone?: string;
}, client?: SupabaseClient): Promise<{ orders: Order[]; sync: OrderSyncSummary | null; readError?: string }> {
  const range = filters?.dateFrom && filters.dateTo && filters.timeZone
    ? { from: filters.dateFrom, to: filters.dateTo, timeZone: filters.timeZone }
    : { from: ymd(new Date(Date.now() - 30 * 86_400_000)), to: ymd(new Date()), timeZone: "UTC" };
  if (!isSupabaseConfigured()) return { orders: [], sync: null, readError: "Supabase is not configured." };

  try {
    const supabase = client ?? await createClient();
    const syncQuery = supabase
      .from("order_sync_runs")
      .select("status,requested_from,requested_to,finished_at,machines_failed")
      .eq("requested_device_imeis", "{}")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("v_orders")
        .select("*")
        .gte("order_time", `${shiftDay(range.from, -1)}T00:00:00Z`)
        .lte("order_time", `${shiftDay(range.to, 1)}T23:59:59Z`)
        .order("order_time", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...((data as Record<string, unknown>[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    const { data: fleetRun, error: syncError } = await syncQuery;
    if (syncError) throw syncError;
    const sync = fleetRun ? {
      status: String(fleetRun.status),
      requestedFrom: String(fleetRun.requested_from),
      requestedTo: String(fleetRun.requested_to),
      finishedAt: (fleetRun.finished_at as string | null) ?? null,
      failedMachines: Number(fleetRun.machines_failed ?? 0),
    } : null;
    const orders = rows.map(orderFromSupabaseRow);

    let filtered = orders;
    if (filters?.machine) {
      const q = filters.machine.toLowerCase();
      filtered = filtered.filter((o) => (o.machine_name ?? "").toLowerCase().includes(q) || (o.device_imei ?? "").includes(q));
    }
    if (filters?.minPrice != null) filtered = filtered.filter((o) => o.price >= filters.minPrice!);
    if (filters?.maxPrice != null) filtered = filtered.filter((o) => o.price <= filters.maxPrice!);
    if (filters?.couponOnly) filtered = filtered.filter((o) => o.coupon_used);
    if (filters?.refundedOnly) filtered = filtered.filter((o) => o.refund_status === "Refunded");
    if (filters?.serverModeOnly) filtered = filtered.filter((o) => o.is_server_mode);
    filtered = filtered.filter((order) => {
      const day = localYmd(new Date(order.order_time), range.timeZone);
      return day >= range.from && day <= range.to;
    });

    return { orders: filtered, sync };
  } catch (error) {
    console.error("[orders] Supabase read failed:", error);
    return { orders: [], sync: null, readError: error instanceof Error ? error.message : String(error) };
  }
}
