import { NextResponse } from "next/server";
import { isFaultWebhook, isOrderWebhook } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { orderPatchFromWebhook, tenantForOrder, type OrderAssignment } from "@/lib/data/order-persistence";

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
      if (supabase) {
        const row = orderPatchFromWebhook(body);
        if (!row) throw new Error("Huaxin order webhook missing orderCode");
        const imei = row.device_imei as string | undefined;
        const { data: machine } = imei
          ? await supabase.from("machines").select("id,tenant_id").eq("device_imei", imei).maybeSingle()
          : { data: null };
        const { data: assignmentRows } = machine
          ? await supabase.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date,end_date").eq("machine_id", machine.id)
          : { data: [] };
        const { error } = await supabase.from("huaxin_orders").upsert({
          ...row,
          ...(machine ? {
            machine_id: machine.id,
            tenant_id: tenantForOrder((assignmentRows as OrderAssignment[]) ?? [], machine.id, (row.order_time as string) ?? null) ?? machine.tenant_id,
          } : {}),
        }, { onConflict: "order_code" });
        if (error) throw error;
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
