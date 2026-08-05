import { getApiSession } from "@/lib/auth/api-session";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import { getMachines } from "@/lib/data/machines";
import { getOrders } from "@/lib/data/orders";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });

  try {
    const date = ymd(new Date(), DEFAULT_TZ);
    const service = await createServiceClient();
    const [{ machines, readError }, orderResult] = await Promise.all([
      getMachines(),
      getOrders({ dateFrom: date, dateTo: date, timeZone: DEFAULT_TZ }, service),
    ]);
    if (readError) throw new Error(readError);
    if (orderResult.readError) throw new Error(orderResult.readError);

    const sales = new Map<string, { amount: number; orders: number; units: number }>();
    for (const order of orderResult.orders) {
      if (!order.device_imei || order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
      const row = sales.get(order.device_imei) ?? { amount: 0, orders: 0, units: 0 };
      row.amount += order.price;
      row.orders++;
      row.units += order.nums;
      sales.set(order.device_imei, row);
    }

    return Response.json({
      date,
      time_zone: DEFAULT_TZ,
      order_sync: orderResult.sync,
      sales_stale: !orderResult.sync || orderResult.sync.status !== "succeeded" || orderResult.sync.failedMachines > 0,
      machines: machines.map((machine) => {
        const today = sales.get(machine.device_imei ?? "") ?? { amount: 0, orders: 0, units: 0 };
        return {
          id: machine.id,
          name: machine.display_name || machine.name,
          imei: machine.device_imei,
          location: machine.location,
          online: machine.net_online,
          oos: machine.oos,
          active_alert_count: machine.active_alert_count,
          status_observed_at: machine.status_observed_at,
          status_stale: !machine.status_observed_at || Date.now() - Date.parse(machine.status_observed_at) > 2 * 60 * 60 * 1000,
          sales_today: Number(today.amount.toFixed(2)),
          orders_today: today.orders,
          units_today: today.units,
        };
      }),
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
