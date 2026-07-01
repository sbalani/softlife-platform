import { NextResponse } from "next/server";
import { isFaultWebhook, isOrderWebhook } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Huaxin POSTs order + device-fault events here. Never return 5xx — Huaxin
 *  would retry forever. ACK with {"result": true}. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const token = process.env.HUAXIN_NOTIFY_TOKEN;
  if (token) {
    const provided =
      req.headers.get("x-huaxin-token") ?? new URL(req.url).searchParams.get("token");
    if (provided !== token) {
      return NextResponse.json({ result: false, message: "invalid token" }, { status: 403 });
    }
  }

  const supabase = isSupabaseConfigured() ? await createServiceClient() : null;

  try {
    if (isOrderWebhook(body)) {
      const d = (body as { data?: Record<string, unknown> }).data ?? {};
      if (supabase) {
        await supabase.from("huaxin_orders").upsert(
          {
            order_code: (d.orderCode as string) ?? "",
            device_imei: (d.deviceImei as string) ?? null,
            order_state: ((d.orderState as string) ?? "").toUpperCase(),
            order_time: d.orderTime ? new Date(d.orderTime as string).toISOString() : new Date().toISOString(),
            price: Number(d.price ?? 0),
            amount: Number(d.amount ?? 0),
            product_name: (d.productName as string) ?? "",
            detail_raw: (d.detail as string) ?? "",
            raw: JSON.stringify(body),
          },
          { onConflict: "order_code" },
        );
      }
    } else if (isFaultWebhook(body)) {
      const b = body as { deviceId?: string; subject?: string; htmlBody?: string };
      if (supabase) {
        await supabase.from("huaxin_faults").insert({
          device_id_huaxin: b.deviceId ?? "",
          subject: b.subject ?? "",
          html_body: b.htmlBody ?? "",
          received_at: new Date().toISOString(),
          raw: JSON.stringify(body),
        });
      }
    }
  } catch (err) {
    console.error("[huaxin/notify] handler error:", err);
  }

  return NextResponse.json({ result: true, message: "OK" });
}
