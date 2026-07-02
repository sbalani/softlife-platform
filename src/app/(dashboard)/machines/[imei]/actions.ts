"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type SaveResult = { ok: boolean; error?: string };

const SLOTS: { position: string; product_type: string }[] = [
  { position: "solid_1", product_type: "topping" },
  { position: "solid_2", product_type: "topping" },
  { position: "solid_3", product_type: "topping" },
  { position: "liquid_1", product_type: "sauce" },
  { position: "liquid_2", product_type: "sauce" },
  { position: "liquid_3", product_type: "sauce" },
];

export async function saveMachineConfig(_prev: SaveResult | null, fd: FormData): Promise<SaveResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const machineId = String(fd.get("machine_id") ?? "");
  const imei = String(fd.get("imei") ?? "");
  if (!machineId) return { ok: false, error: "Machine isn't in Supabase yet — sync first." };

  try {
    const s = await createServiceClient();
    const base = String(fd.get("base_product_id") ?? "");
    const profile = String(fd.get("profile") ?? "");
    const lastClean = String(fd.get("last_full_clean") ?? "");

    const { error: mErr } = await s
      .from("machines")
      .update({
        base_product_id: base || null,
        profile: profile || null,
        last_full_clean_date: lastClean ? new Date(lastClean).toISOString() : null,
      })
      .eq("id", machineId);
    if (mErr) return { ok: false, error: mErr.message };

    await s.from("machine_ingredients").delete().eq("machine_id", machineId);

    const rows = SLOTS.map((slot) => {
      const pid = String(fd.get(slot.position) ?? "");
      if (!pid) return null;
      return { machine_id: machineId, position: slot.position, product_id: pid, product_type: slot.product_type, enabled: true };
    }).filter(Boolean) as { machine_id: string; position: string; product_id: string; product_type: string; enabled: boolean }[];

    if (rows.length) {
      const { error: iErr } = await s.from("machine_ingredients").insert(rows);
      if (iErr) return { ok: false, error: iErr.message };
    }

    revalidatePath(`/machines/${imei}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
