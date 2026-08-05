import { getApiSession } from "@/lib/auth/api-session";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import { getOrders } from "@/lib/data/orders";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const requested = new URL(req.url).searchParams.get("date");
    const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : ymd(new Date(), DEFAULT_TZ);
    const result = await getOrders({ dateFrom: date, dateTo: date, timeZone: DEFAULT_TZ }, await createServiceClient());
    if (result.readError) throw new Error(result.readError);
    return Response.json({
      date,
      time_zone: DEFAULT_TZ,
      sync: result.sync,
      orders: result.orders.map((order) => ({
        id: order.id,
        order_time: order.order_time,
        order_code: order.order_code,
        machine_name: order.machine_name,
        device_imei: order.device_imei,
        product_name: order.product_name,
        state: order.order_state,
        price: order.price,
        units: order.nums,
        pay_type: order.pay_type,
        refunded: order.refund_status === "Refunded",
        admin_override: order.is_admin_override,
      })),
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
