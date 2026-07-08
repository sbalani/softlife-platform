import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ accepted: [], rejected: [] });
  }
  const body = await req.json();
  const records: Record<string, unknown>[] = body.records ?? [];

  try {
    const s = await createServiceClient();
    const accepted: string[] = [];
    const rejected: { client_uuid: string; reason: string }[] = [];

    for (const r of records) {
      const clientUuid = String(r.client_uuid ?? "");

      // Idempotency check
      const { data: existing } = await s
        .from("reposiciones")
        .select("client_uuid")
        .eq("client_uuid", clientUuid)
        .maybeSingle();
      if (existing) {
        accepted.push(clientUuid);
        continue;
      }

      // Map numeric machine_id → Supabase uuid
      const machineIdNum = String(r.machine_id ?? "");
      const { data: machine } = await s
        .from("machines")
        .select("id,name,device_imei")
        .eq("device_id_huaxin", machineIdNum)
        .maybeSingle();
      const machineUuid = (machine as Record<string, unknown> | null)?.id ?? null;
      const machineName = (machine as Record<string, unknown> | null)?.name ?? null;
      const deviceImei = (machine as Record<string, unknown> | null)?.device_imei ?? null;

      // Insert reposicion
      const { error } = await s.from("reposiciones").insert({
        client_uuid: clientUuid,
        machine_id: machineUuid,
        operator_id: String(r.operator_id ?? ""),
        device_event_time: r.device_event_time ?? new Date().toISOString(),
        payload_json: r,
        status: "synced",
        synced_at: new Date().toISOString(),
      });
      if (error) {
        rejected.push({ client_uuid: clientUuid, reason: error.message });
        continue;
      }

      // Process lines → lot_usages (audit trail) + decrement the lot's on-hand qty.
      // Lines only carry lot_name, not a real lots.id (the mobile app's numeric
      // lot_id is a synthetic per-request index, not a stable identifier —
      // matches how LogLotForm already keys off lot_name elsewhere).
      const lines = (r.lines as Record<string, unknown>[]) ?? [];
      for (const line of lines) {
        const lotName = String(line.lot_name ?? "");
        const quantity = Number(line.quantity_used ?? 0) || null;
        const { data: lot } = await s.from("lots").select("id,product_name").eq("name", lotName).maybeSingle();
        const lotRow = lot as { id?: string; product_name?: string } | null;

        await s.from("lot_usages").insert({
          machine_id: machineUuid,
          machine_name: machineName as string,
          device_imei: deviceImei as string,
          lot_name: lotName,
          product_name: lotRow?.product_name ?? null,
          quantity,
          device_event_time: (line.device_event_time as string) ?? (r.device_event_time as string) ?? new Date().toISOString(),
        });

        if (lotRow?.id && quantity) {
          const { error: decErr } = await s.rpc("decrement_lot_qty", { p_lot_id: lotRow.id, p_amount: quantity });
          if (decErr) console.error("[reposicion/sync] failed to decrement lot qty for", lotRow.id, decErr);
        }
      }

      accepted.push(clientUuid);
    }

    return Response.json({ accepted, rejected });
  } catch (e) {
    return Response.json(
      { accepted: [], rejected: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
