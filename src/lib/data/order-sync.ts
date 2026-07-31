import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfigFromEnv, listAllOrders, listDevices } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { selectOrderDevices } from "@/lib/data/order-sync-selection";
import { orderPatchFromWebhook, orderRowFromHuaxin, tenantForOrder, type OrderAssignment } from "@/lib/data/order-persistence";
import { huaxinOrderTime } from "@/lib/huaxin/order-time";
import { orderSyncStatus, type OrderSyncStatus } from "@/lib/data/order-sync-status";

export type OrderSyncTrigger = "orders_page" | "settings" | "cron";
export type OrderMachineSyncFailure = { deviceImei: string; machineName: string | null; error: string };
export type OrderSyncResult = {
  ok: boolean;
  status: OrderSyncStatus;
  orders: number;
  machines: number;
  succeededMachines: number;
  failedMachines: OrderMachineSyncFailure[];
  runId?: string;
  error?: string;
};

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
export async function ingestOrders(from: string, to: string, selectedImeis: string[] = [], trigger: OrderSyncTrigger = "orders_page"): Promise<OrderSyncResult> {
  const cfg = getConfigFromEnv();
  const failedResult = (error: string): OrderSyncResult => ({
    ok: false, status: "failed", orders: 0, machines: 0, succeededMachines: 0, failedMachines: [], error,
  });
  if (!cfg) return failedResult("Huaxin not configured.");
  if (!isSupabaseConfigured()) return failedResult("Supabase not configured.");

  const began = `${from} 00:00:00`;
  const end = `${to} 23:59:59`;
  const supabase = await createServiceClient();
  let runId: string | undefined;
  let orders = 0;
  let succeededMachines = 0;
  const failedMachines: OrderMachineSyncFailure[] = [];

  try {
    const { data: run, error: runError } = await supabase.from("order_sync_runs").insert({
      trigger_source: trigger,
      requested_from: from,
      requested_to: to,
      requested_device_imeis: selectedImeis,
    }).select("id").single();
    if (runError || !run) throw runError ?? new Error("Could not create order sync run");
    runId = run.id as string;

    const { devices, missing } = selectOrderDevices(await listDevices(cfg, { force: true }), selectedImeis);
    const { data: machineRows, error: machineError } = await supabase.from("machines").select("id,tenant_id,device_imei,name");
    if (machineError) throw machineError;
    const { data: assignmentRows, error: assignmentError } = await supabase.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date,end_date");
    if (assignmentError) throw assignmentError;
    const assignments = (assignmentRows as OrderAssignment[]) ?? [];
    const machineByImei = new Map(
      ((machineRows as { id: string; tenant_id: string | null; device_imei: string | null; name: string | null }[]) ?? [])
        .filter((m) => m.device_imei)
        .map((m) => [m.device_imei!, m]),
    );

    for (const imei of missing) {
      const failure = { deviceImei: imei, machineName: machineByImei.get(imei)?.name ?? null, error: "Selected machine not found in Huaxin" };
      failedMachines.push(failure);
      const now = new Date().toISOString();
      const { error } = await supabase.from("order_sync_machine_results").insert({
        run_id: runId, machine_id: machineByImei.get(imei)?.id ?? null, device_imei: imei,
        machine_name: failure.machineName, status: "failed", started_at: now, finished_at: now, error: failure.error,
      });
      if (error) throw error;
    }

    for (const d of devices) {
      if (!d.deviceImei) continue;
      const startedAt = new Date().toISOString();
      const machine = machineByImei.get(d.deviceImei);
      let machineOrders = 0;
      let failure: OrderMachineSyncFailure | null = null;
      try {
        const ords = (await listAllOrders(cfg, d.deviceImei, began, end)).filter((o) => o.orderCode);
        const rows = ords.map((order) => orderRowFromHuaxin(order, {
          id: machine?.id ?? null,
          tenantId: tenantForOrder(assignments, machine?.id ?? null, huaxinOrderTime(order)) ?? machine?.tenant_id ?? null,
          imei: d.deviceImei!,
        }));
        machineOrders = await upsertOrders(supabase, rows);
        orders += machineOrders;
        succeededMachines++;
      } catch (error) {
        failure = {
          deviceImei: d.deviceImei,
          machineName: machine?.name ?? (d.deviceLabel as string) ?? d.deviceName ?? null,
          error: error instanceof Error ? error.message : String(error),
        };
        failedMachines.push(failure);
      }

      const { error: resultError } = await supabase.from("order_sync_machine_results").insert({
        run_id: runId,
        machine_id: machine?.id ?? null,
        device_imei: d.deviceImei,
        machine_name: machine?.name ?? (d.deviceLabel as string) ?? d.deviceName ?? null,
        status: failure ? "failed" : "succeeded",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        orders_fetched: machineOrders,
        fresh_through: failure ? null : to,
        error: failure?.error ?? null,
      });
      if (resultError) throw resultError;
    }

    const status = orderSyncStatus(succeededMachines, failedMachines.length);
    const { error: finishError } = await supabase.from("order_sync_runs").update({
      status,
      finished_at: new Date().toISOString(),
      machines_total: succeededMachines + failedMachines.length,
      machines_succeeded: succeededMachines,
      machines_failed: failedMachines.length,
      orders_fetched: orders,
    }).eq("id", runId);
    if (finishError) throw finishError;
    return {
      ok: status === "succeeded", status, orders, machines: succeededMachines + failedMachines.length,
      succeededMachines, failedMachines, runId,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (runId) {
      await supabase.from("order_sync_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        machines_total: succeededMachines + failedMachines.length,
        machines_succeeded: succeededMachines,
        machines_failed: failedMachines.length,
        orders_fetched: orders,
        error,
      }).eq("id", runId);
    }
    return { ...failedResult(error), orders, machines: succeededMachines + failedMachines.length, succeededMachines, failedMachines, runId };
  }
}
