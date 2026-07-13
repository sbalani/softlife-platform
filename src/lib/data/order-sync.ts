import { getConfigFromEnv, listAllOrders, listDevices } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type OrderSyncResult = { ok: boolean; orders: number; machines: number; error?: string };

function toIso(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pulls every order (all pages) for every device in [from, to] and upserts
 *  into huaxin_orders, keyed by order_code. Shared by the Settings full sync
 *  and the Orders page's on-demand update/backfill. Dates are YYYY-MM-DD. */
export async function ingestOrders(from: string, to: string): Promise<OrderSyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, orders: 0, machines: 0, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, orders: 0, machines: 0, error: "Supabase not configured." };

  const began = `${from} 00:00:00`;
  const end = `${to} 23:59:59`;

  try {
    const supabase = await createServiceClient();
    const devices = await listDevices(cfg, { force: true });
    const { data: machineRows } = await supabase.from("machines").select("id,device_imei");
    const machineIdByImei = new Map(
      ((machineRows as { id: string; device_imei: string | null }[]) ?? [])
        .filter((m) => m.device_imei)
        .map((m) => [m.device_imei!, m.id]),
    );

    let orders = 0;
    let machines = 0;
    for (const d of devices) {
      if (!d.deviceImei) continue;
      machines++;
      try {
        const ords = (await listAllOrders(cfg, d.deviceImei, began, end)).filter((o) => o.orderCode);
        const rows = ords.map((o) => ({
          machine_id: machineIdByImei.get(d.deviceImei!) ?? null,
          device_imei: d.deviceImei,
          order_code: o.orderCode!,
          out_trade_no: o.outTradeNo ?? null,
          order_state: String(o.status ?? ""),
          order_time: toIso(o.createTime),
          price: Number(o.price ?? 0),
          amount: Number(o.amount ?? 0),
          product_name: o.products?.[0]?.goodsName ?? o.goodsName ?? null,
        }));
        if (rows.length) {
          const { error } = await supabase.from("huaxin_orders").upsert(rows, { onConflict: "order_code" });
          if (!error) orders += rows.length;
        }
      } catch {
        /* per-device errors are non-fatal */
      }
    }
    return { ok: true, orders, machines };
  } catch (e) {
    return { ok: false, orders: 0, machines: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
