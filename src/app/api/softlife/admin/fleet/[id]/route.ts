import { getApiSession } from "@/lib/auth/api-session";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import { getMachines } from "@/lib/data/machines";
import { getOrders } from "@/lib/data/orders";
import { statusDisplayRank, type HuaxinStatusRow } from "@/lib/huaxin/status-signals";
import { translateStatusDesc, translateStatusValue } from "@/lib/i18n/huaxin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const { id } = await params;
    const date = ymd(new Date(), DEFAULT_TZ);
    const service = await createServiceClient();
    const [{ machines, readError }, statusResult, orderResult] = await Promise.all([
      getMachines(),
      service.from("machine_status_snapshots").select("field,raw,observed_at").eq("machine_id", id).like("field", "raw:%"),
      getOrders({ dateFrom: date, dateTo: date, timeZone: DEFAULT_TZ }, service),
    ]);
    if (readError) throw new Error(readError);
    if (statusResult.error) throw statusResult.error;
    if (orderResult.readError) throw new Error(orderResult.readError);
    const machine = machines.find((row) => row.id === id);
    if (!machine) return Response.json({ error: { message: "Machine not found" } }, { status: 404 });

    const statuses = [...new Map(((statusResult.data as { raw: HuaxinStatusRow; observed_at: string }[]) ?? []).map((row) => [row.raw.code, row])).values()]
      .sort((a, b) => statusDisplayRank(a.raw) - statusDisplayRank(b.raw) || translateStatusDesc(a.raw.desc ?? a.raw.code).localeCompare(translateStatusDesc(b.raw.desc ?? b.raw.code)))
      .map((row) => ({ code: row.raw.code ?? "", label: translateStatusDesc(row.raw.desc ?? row.raw.code), value: translateStatusValue(row.raw.value ?? String(row.raw.data ?? "")), observed_at: row.observed_at }));
    const orders = orderResult.orders.filter((order) => order.device_imei === machine.device_imei);
    const sales = orders.filter((order) => order.order_state === "COMPLETE" && !order.is_admin_override && order.refund_status !== "Refunded");

    return Response.json({
      date,
      time_zone: DEFAULT_TZ,
      order_sync: orderResult.sync,
      sales_stale: !orderResult.sync || orderResult.sync.status !== "succeeded" || orderResult.sync.failedMachines > 0,
      machine: {
        id: machine.id,
        name: machine.display_name || machine.name,
        imei: machine.device_imei,
        location: machine.location,
        online: machine.net_online,
        oos: machine.oos,
        active_alert_count: machine.active_alert_count,
        status_observed_at: machine.status_observed_at,
        status_stale: !machine.status_observed_at || Date.now() - Date.parse(machine.status_observed_at) > 2 * 60 * 60 * 1000,
        sales_today: Number(sales.reduce((sum, order) => sum + order.price, 0).toFixed(2)),
        orders_today: sales.length,
        units_today: sales.reduce((sum, order) => sum + order.nums, 0),
      },
      statuses,
      orders: orders.slice(0, 50).map((order) => ({ id: order.id, order_time: order.order_time, order_code: order.order_code, product_name: order.product_name, state: order.order_state, price: order.price, units: order.nums, refunded: order.refund_status === "Refunded", admin_override: order.is_admin_override })),
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
