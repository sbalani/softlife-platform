import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfigFromEnv, listAllOrders, listDevices } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { selectOrderDevices } from "@/lib/data/order-sync-selection";
import { orderPatchFromWebhook, orderRowFromHuaxin, tenantForOrder, type OrderAssignment } from "@/lib/data/order-persistence";
import { huaxinOrderTime } from "@/lib/huaxin/order-time";

export type OrderSyncResult = { ok: boolean; orders: number; machines: number; error?: string };

async function upsertOrders(supabase: SupabaseClient, rows: Record<string, unknown>[]) {
  if (!rows.length) return 0;
  const { error } = await supabase.from("huaxin_orders").upsert(rows, { onConflict: "order_code" });
  if (error) throw error;
  return rows.length;
}

export async function ingestOrderWebhook(supabase: SupabaseClient, body: unknown) {
  const row = orderPatchFromWebhook(body);
  if (!row) throw new Error("Huaxin order webhook missing orderCode");
  const imei = row.device_imei as string | undefined;
  const { data: machine } = imei
    ? await supabase.from("machines").select("id,tenant_id").eq("device_imei", imei).maybeSingle()
    : { data: null };
  const { data: assignmentRows } = machine
    ? await supabase.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date,end_date").eq("machine_id", machine.id)
    : { data: [] };
  return upsertOrders(supabase, [{
    ...row,
    ...(machine ? {
      machine_id: machine.id,
      tenant_id: tenantForOrder((assignmentRows as OrderAssignment[]) ?? [], machine.id, (row.order_time as string) ?? null) ?? machine.tenant_id,
    } : {}),
  }]);
}

/** Pulls every order (all pages) for selected devices, or every device when
 *  none are selected, in [from, to] and upserts
 *  into huaxin_orders, keyed by order_code. Shared by the Settings full sync
 *  and the Orders page's on-demand update/backfill. Dates are YYYY-MM-DD. */
export async function ingestOrders(from: string, to: string, selectedImeis: string[] = []): Promise<OrderSyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, orders: 0, machines: 0, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, orders: 0, machines: 0, error: "Supabase not configured." };

  const began = `${from} 00:00:00`;
  const end = `${to} 23:59:59`;

  try {
    const supabase = await createServiceClient();
    const { devices, missing } = selectOrderDevices(await listDevices(cfg, { force: true }), selectedImeis);
    if (missing.length) return { ok: false, orders: 0, machines: 0, error: `Selected machine not found in Huaxin: ${missing.join(", ")}` };
    const { data: machineRows } = await supabase.from("machines").select("id,tenant_id,device_imei");
    const { data: assignmentRows } = await supabase.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date,end_date");
    const assignments = (assignmentRows as OrderAssignment[]) ?? [];
    const machineByImei = new Map(
      ((machineRows as { id: string; tenant_id: string | null; device_imei: string | null }[]) ?? [])
        .filter((m) => m.device_imei)
        .map((m) => [m.device_imei!, m]),
    );

    let orders = 0;
    let machines = 0;
    for (const d of devices) {
      if (!d.deviceImei) continue;
      machines++;
      try {
        const ords = (await listAllOrders(cfg, d.deviceImei, began, end)).filter((o) => o.orderCode);
        const machine = machineByImei.get(d.deviceImei);
        const rows = ords.map((order) => orderRowFromHuaxin(order, {
          id: machine?.id ?? null,
          tenantId: tenantForOrder(assignments, machine?.id ?? null, huaxinOrderTime(order)) ?? machine?.tenant_id ?? null,
          imei: d.deviceImei!,
        }));
        orders += await upsertOrders(supabase, rows);
      } catch {
        /* per-device errors are non-fatal */
      }
    }
    return { ok: true, orders, machines };
  } catch (e) {
    return { ok: false, orders: 0, machines: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
