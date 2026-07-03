import { NextResponse } from "next/server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const fd = await req.formData();
  const machineId = String(fd.get("machine_id") ?? "");
  const imei = String(fd.get("imei") ?? "");
  const machineName = String(fd.get("machine_name") ?? "");
  const ingredient = JSON.parse(String(fd.get("ingredient") ?? "{}"));
  const lotName = String(fd.get("lot_name") ?? "").trim();
  const quantity = Number(fd.get("quantity") ?? 0) || null;

  if (!machineId || !lotName) return NextResponse.json({ error: "Missing machine or lot" }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  try {
    const s = await createServiceClient();
    await s.from("lot_usages").insert({
      machine_id: machineId,
      machine_name: machineName,
      device_imei: imei,
      product_id: ingredient.product_id || null,
      product_name: ingredient.product_name || null,
      product_type: ingredient.product_type || "topping",
      lot_name: lotName,
      position: ingredient.position || null,
      quantity,
      device_event_time: new Date().toISOString(),
    });
    if (ingredient.position) {
      await s.from("machine_ingredients")
        .update({ current_lot_name: lotName, last_loaded_date: new Date().toISOString() })
        .eq("machine_id", machineId)
        .eq("position", ingredient.position);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
