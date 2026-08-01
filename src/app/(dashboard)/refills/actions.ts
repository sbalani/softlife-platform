"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";

export type RefillResult = { ok: boolean; error?: string; warning?: string };

export async function submitRefill(_prev: RefillResult | null, fd: FormData): Promise<RefillResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const session = await getSessionProfile();
  if (!session) return { ok: false, error: "Sign in to log a refill." };
  const machineId = String(fd.get("machine_id") ?? "");
  if (!machineId) return { ok: false, error: "Select a machine." };

  const lotIds = fd.getAll("lot_id").map(String);
  const qtys = fd.getAll("qty").map(String);
  const photos = fd.getAll("photo");

  const lines: { lotId: string; qty: number; photo: File | null }[] = [];
  for (let i = 0; i < lotIds.length; i++) {
    const qty = Number(qtys[i]);
    if (!lotIds[i] || !Number.isFinite(qty) || qty <= 0) continue;
    const photo = photos[i];
    lines.push({ lotId: lotIds[i], qty, photo: photo instanceof File && photo.size ? photo : null });
  }
  if (!lines.length) return { ok: false, error: "Add at least one lot with a quantity." };

  try {
    const s = await createServiceClient();
    const { data: machine } = await s.from("machines").select("id").eq("id", machineId).maybeSingle();
    if (!machine) return { ok: false, error: "Machine not found." };

    const { data: lotsData } = await s.from("lots").select("id,name,product_name").in("id", lines.map((l) => l.lotId));
    const lotById = new Map(((lotsData as Record<string, unknown>[]) ?? []).map((l) => [l.id as string, l]));

    const ts = new Date().toISOString();
    const operatorId = session.id;
    if (!await canAccessMachine(s, session, machineId, ts)) return { ok: false, error: "Machine access denied." };

    const linePayload: { client_uuid: string; lot_id: string; lot_name: string; quantity_used: number; photo_url: string | null; device_event_time: string }[] = [];
    for (const line of lines) {
      const lot = lotById.get(line.lotId) as { name?: string; product_name?: string } | undefined;
      let photoUrl: string | null = null;
      if (line.photo) {
        const ext = (line.photo.name.split(".").pop() || "jpg").toLowerCase();
        const path = `refills/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await s.storage
          .from("reposicion-photos")
          .upload(path, await line.photo.arrayBuffer(), { contentType: line.photo.type || "image/*", upsert: true });
        if (!upErr) photoUrl = s.storage.from("reposicion-photos").getPublicUrl(path).data.publicUrl;
      }
      linePayload.push({
        client_uuid: crypto.randomUUID(),
        lot_id: line.lotId,
        lot_name: lot?.name ?? "",
        quantity_used: line.qty,
        photo_url: photoUrl,
        device_event_time: ts,
      });
    }

    const { error } = await s.rpc("record_refill", {
      p_client_uuid: crypto.randomUUID(),
      p_machine_id: machineId,
      p_operator_id: operatorId,
      p_device_event_time: ts,
      p_payload: { machine_id: machineId, operator_id: operatorId, device_event_time: ts, lines: linePayload },
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/refills");
    revalidatePath("/inventory");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
