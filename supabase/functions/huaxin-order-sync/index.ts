import { createClient } from "@supabase/supabase-js";
import {
  type HuaxinDevice,
  type HuaxinOrder,
  huaxinOrderTime,
  madridDate,
  type OrderAssignment,
  orderRowFromHuaxin,
  orderSyncStatus,
  previousCalendarDate,
  selectOrderDevices,
  tenantForOrder,
} from "./order.ts";

type Machine = {
  id: string;
  tenant_id: string | null;
  device_imei: string | null;
  name: string | null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMEI = /^\d{8,20}$/;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function authorized(request: Request) {
  const token = request.headers.get("x-order-sync-token");
  if (!token || token.length < 32) return false;
  const { data, error } = await supabase.rpc("verify_order_sync_cron_token", {
    p_token: token,
  });
  return !error && data === true;
}

async function bridge(body: Record<string, unknown>) {
  const token = Deno.env.get("HUAXIN_ORDER_BRIDGE_TOKEN");
  if (!token) throw new Error("Huaxin order bridge is not configured");
  const response = await fetch(
    Deno.env.get("HUAXIN_ORDER_BRIDGE_URL") ??
      "https://platform.softlife.es/api/internal/huaxin-orders",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-huaxin-order-token": token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const data = await response.json().catch(() => ({})) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      String(
        data.error ?? `Huaxin order bridge returned HTTP ${response.status}`,
      ),
    );
  }
  return data;
}

function requestedRange(payload: { from?: unknown; to?: unknown }) {
  const today = madridDate(new Date());
  const from = typeof payload.from === "string"
    ? payload.from
    : previousCalendarDate(today);
  const to = typeof payload.to === "string" ? payload.to : today;
  if (
    !DATE.test(from) || !DATE.test(to) || from > to ||
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >
      92 * 86_400_000
  ) {
    throw new Error("Invalid order sync date range");
  }
  return { from, to };
}

async function renew(owner: string) {
  const { data, error } = await supabase.rpc("renew_order_sync_lock", {
    p_owner: owner,
  });
  if (error || !data) throw error ?? new Error("The order sync lease expired");
}

async function upsertOrders(rows: Record<string, unknown>[], owner: string) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    await renew(owner);
    const { error } = await supabase.from("huaxin_orders").upsert(
      rows.slice(offset, offset + 500),
      { onConflict: "order_code" },
    );
    if (error) throw error;
  }
}

async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!await authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => ({})) as {
    trigger_source?: unknown;
    from?: unknown;
    to?: unknown;
    device_imeis?: unknown;
  };
  const triggerSource = payload.trigger_source === "settings"
    ? "settings"
    : "cron";
  let range: { from: string; to: string };
  let selectedImeis: string[];
  try {
    range = requestedRange(payload);
    selectedImeis = Array.isArray(payload.device_imeis)
      ? payload.device_imeis.map(String)
      : [];
    if (selectedImeis.some((imei) => !IMEI.test(imei))) {
      throw new Error("Invalid device IMEI");
    }
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 400 });
  }

  const owner = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_order_sync_lock",
    { p_owner: owner },
  );
  if (claimError) {
    return Response.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed) {
    return Response.json({ error: "An order sync is already running" }, {
      status: 409,
    });
  }

  let runId: string | null = null;
  let orders = 0;
  let succeeded = 0;
  let failed = 0;
  try {
    const { data: run, error: runError } = await supabase.from(
      "order_sync_runs",
    ).insert({
      trigger_source: triggerSource,
      executor: "supabase_edge",
      requested_from: range.from,
      requested_to: range.to,
      requested_device_imeis: selectedImeis,
    }).select("id").single();
    if (runError || !run) {
      throw runError ?? new Error("Could not create order sync run");
    }
    runId = String(run.id);

    const deviceResponse = await bridge({ operation: "devices" });
    const allDevices = Array.isArray(deviceResponse.devices)
      ? deviceResponse.devices as HuaxinDevice[]
      : null;
    if (!allDevices) {
      throw new Error("Huaxin order bridge returned invalid devices");
    }
    const { devices, missing } = selectOrderDevices(allDevices, selectedImeis);
    const [
      { data: machineData, error: machineError },
      { data: assignmentData, error: assignmentError },
    ] = await Promise.all([
      supabase.from("machines").select("id,tenant_id,device_imei,name"),
      supabase.from("machine_franchisee_assignments").select(
        "machine_id,tenant_id,start_date,end_date",
      ),
    ]);
    if (machineError) throw machineError;
    if (assignmentError) throw assignmentError;
    const machines = (machineData as Machine[]) ?? [];
    const assignments = (assignmentData as OrderAssignment[]) ?? [];
    const machineByImei = new Map(
      machines.flatMap((machine) =>
        machine.device_imei ? [[machine.device_imei, machine] as const] : []
      ),
    );

    for (const imei of missing) {
      const machine = machineByImei.get(imei);
      const now = new Date().toISOString();
      const { error } = await supabase.from("order_sync_machine_results")
        .insert({
          run_id: runId,
          machine_id: machine?.id ?? null,
          device_imei: imei,
          machine_name: machine?.name ?? null,
          status: "failed",
          started_at: now,
          finished_at: now,
          error: "Selected machine not found in Huaxin",
        });
      if (error) throw error;
      failed++;
    }

    for (const device of devices) {
      if (!device.deviceImei) continue;
      const startedAt = new Date().toISOString();
      const machine = machineByImei.get(device.deviceImei);
      let machineOrders = 0;
      let machineErrorMessage: string | null = null;
      try {
        await renew(owner);
        const orderResponse = await bridge({
          operation: "orders",
          device_imei: device.deviceImei,
          began_time: `${range.from} 00:00:00`,
          end_time: `${range.to} 23:59:59`,
        });
        const remoteOrders = Array.isArray(orderResponse.orders)
          ? orderResponse.orders as HuaxinOrder[]
          : null;
        if (!remoteOrders) {
          throw new Error("Huaxin order bridge returned invalid orders");
        }
        const rows = remoteOrders.filter((order) => order.orderCode).map((
          order,
        ) =>
          orderRowFromHuaxin(order, {
            id: machine?.id ?? null,
            tenantId: tenantForOrder(
              assignments,
              machine?.id ?? null,
              huaxinOrderTime(order),
            ) ?? machine?.tenant_id ?? null,
            imei: device.deviceImei!,
          })
        );
        await upsertOrders(rows, owner);
        machineOrders = rows.length;
        orders += rows.length;
        succeeded++;
      } catch (error) {
        machineErrorMessage = error instanceof Error
          ? error.message
          : String(error);
        failed++;
      }
      const { error: resultError } = await supabase.from(
        "order_sync_machine_results",
      ).insert({
        run_id: runId,
        machine_id: machine?.id ?? null,
        device_imei: device.deviceImei,
        machine_name: machine?.name ??
          (String(device.deviceLabel ?? device.deviceName ?? "") || null),
        status: machineErrorMessage ? "failed" : "succeeded",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        orders_fetched: machineOrders,
        fresh_through: machineErrorMessage ? null : range.to,
        error: machineErrorMessage,
      });
      if (resultError) throw resultError;
    }

    const status = orderSyncStatus(succeeded, failed);
    const { error: finishError } = await supabase.from("order_sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        machines_total: succeeded + failed,
        machines_succeeded: succeeded,
        machines_failed: failed,
        orders_fetched: orders,
      }).eq("id", runId);
    if (finishError) throw finishError;
    return Response.json({
      run_id: runId,
      status,
      orders,
      machines_total: succeeded + failed,
      machines_succeeded: succeeded,
      machines_failed: failed,
    }, { status: status === "succeeded" ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase.from("order_sync_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        machines_total: succeeded + failed,
        machines_succeeded: succeeded,
        machines_failed: failed,
        orders_fetched: orders,
        error: message.slice(0, 2000),
      }).eq("id", runId);
    }
    return Response.json({ run_id: runId, error: message }, { status: 500 });
  } finally {
    const { error } = await supabase.rpc("release_order_sync_lock", {
      p_owner: owner,
    });
    if (error) {
      console.error(
        "[huaxin-order-sync] Could not release lock:",
        error.message,
      );
    }
  }
}

if (import.meta.main) Deno.serve(handler);
export { handler };
