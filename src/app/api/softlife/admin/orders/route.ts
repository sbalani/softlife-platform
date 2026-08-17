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
    const params = new URL(req.url).searchParams;
    const requestedDate = params.get("date");
    const today = ymd(new Date(), DEFAULT_TZ);
    const dateFrom = params.get("from") ?? requestedDate ?? today;
    const dateTo = params.get("to") ?? requestedDate ?? dateFrom;
    const validDate = (value: string) => {
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(timestamp)
        && new Date(timestamp).toISOString().slice(0, 10) === value;
    };
    const rangeDays = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000;
    if (!validDate(dateFrom) || !validDate(dateTo) || !Number.isFinite(rangeDays) || rangeDays < 0 || rangeDays > 89) {
      return Response.json({ error: { message: "Use a valid date range of up to 90 days." } }, { status: 400 });
    }
    const result = await getOrders({ dateFrom, dateTo, timeZone: DEFAULT_TZ }, await createServiceClient());
    if (result.readError) throw new Error(result.readError);
    return Response.json({
      date: dateFrom === dateTo ? dateFrom : `${dateFrom}/${dateTo}`,
      date_from: dateFrom,
      date_to: dateTo,
      time_zone: DEFAULT_TZ,
      sync: result.sync,
      orders: result.orders.map((order) => ({
        id: order.id,
        order_time: order.order_time,
        order_code: order.order_code,
        machine_name: order.machine_name,
        device_imei: order.device_imei,
        product_name: order.product_name,
        products: order.products,
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
