"use server";

import { revalidatePath } from "next/cache";
import { getConfigFromEnv, listDevices, listDeviceProducts } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type SyncResult = { ok: boolean; synced?: number; error?: string };

/** Lightweight sync: just refresh device online statuses + names (no orders/temps). */
export async function syncMachineStatuses(): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const s = await createServiceClient();
    let count = 0;
    for (const d of devices) {
      if (!d.deviceImei) continue;
      const isOnline = (d.onlineStatus as string) === "online";
      await s.from("machines").upsert({
        device_imei: d.deviceImei,
        device_id_huaxin: d.deviceId ?? null,
        name: (d.deviceLabel as string) || d.deviceName || d.deviceImei,
        location: (d.deviceLocation as string) ?? null,
        state: isOnline ? "active" : "stored",
        is_online: isOnline,
        huaxin_last_sync: new Date().toISOString(),
      }, { onConflict: "device_imei" });
      count++;
    }
    revalidatePath("/machines");
    revalidatePath("/dashboard");
    return { ok: true, synced: count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncOneMachine(imei: string): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const d = devices.find((x) => x.deviceImei === imei);
    if (!d) return { ok: false, error: "Device not found in Huaxin." };
    const isOnline = (d.onlineStatus as string) === "online";
    const s = await createServiceClient();
    await s.from("machines").upsert({
      device_imei: imei,
      device_id_huaxin: d.deviceId ?? null,
      name: (d.deviceLabel as string) || d.deviceName || imei,
      location: (d.deviceLocation as string) ?? null,
      state: isOnline ? "active" : "stored",
      is_online: isOnline,
      huaxin_last_sync: new Date().toISOString(),
    }, { onConflict: "device_imei" });

    // Pull live product menu and sync into machine_ingredients
    try {
      const { data: machine } = await s.from("machines").select("id").eq("device_imei", imei).maybeSingle();
      if (machine?.id) {
        await syncProductsToIngredients(s, cfg, imei, machine.id);
      }
    } catch {
      /* product sync is best-effort — device status already succeeded */
    }

    revalidatePath(`/machines/${imei}`);
    revalidatePath("/machines");
    return { ok: true, synced: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const HUAXIN_LANE_TO_CONFIG: Record<string, { position: string; product_type: string }> = {
  "2": { position: "solid_1", product_type: "topping" },
  "3": { position: "solid_2", product_type: "topping" },
  "4": { position: "solid_3", product_type: "topping" },
  "5": { position: "liquid_1", product_type: "sauce" },
  "6": { position: "liquid_2", product_type: "sauce" },
  "7": { position: "liquid_3", product_type: "sauce" },
};

async function syncProductsToIngredients(
  s: Awaited<ReturnType<typeof createServiceClient>>,
  cfg: ReturnType<typeof getConfigFromEnv>,
  imei: string,
  machineId: string,
): Promise<void> {
  if (!cfg) return;
  const { diy } = await listDeviceProducts(cfg, imei);
  const { data: allProducts } = await s.from("products").select("id,name,type,image_url");
  const products = (allProducts as { id: string; name: string; type: string; image_url: string | null }[]) ?? [];
  const findMatch = (name: string) =>
    products.find((p) => p.name.toLowerCase().trim() === name.toLowerCase().trim());

  const syncImage = async (productId: string | undefined | null, huaxinImage: string | undefined) => {
    if (!productId || !huaxinImage) return;
    const p = products.find((x) => x.id === productId);
    if (!p || p.image_url === huaxinImage) return;
    await s.from("products").update({ image_url: huaxinImage }).eq("id", productId);
  };

  // Base (lane 1) → machines.base_product_id
  const baseItem = diy.find((d) => String(d.position) === "1");
  if (baseItem?.goodsName) {
    const match = findMatch(baseItem.goodsName);
    await s.from("machines")
      .update({ base_product_id: match?.id ?? null })
      .eq("id", machineId);
    await syncImage(match?.id, baseItem.imagePath);
  }

  // Lanes 2-7 → machine_ingredients (preserve lot data on existing rows)
  const { data: existing } = await s.from("machine_ingredients")
    .select("id,position").eq("machine_id", machineId);
  const existingByPos = new Map(
    ((existing as { id: string; position: string }[]) ?? []).map((e) => [e.position, e.id]),
  );

  for (const [lane, mapping] of Object.entries(HUAXIN_LANE_TO_CONFIG)) {
    const item = diy.find((d) => String(d.position) === lane);
    if (!item) continue;
    const goodsName = (item.goodsName ?? "").trim();
    const match = goodsName ? findMatch(goodsName) : null;
    await syncImage(match?.id, item.imagePath);
    const existingId = existingByPos.get(mapping.position);
    if (existingId) {
      await s.from("machine_ingredients")
        .update({ product_id: match?.id ?? null, product_type: mapping.product_type, enabled: true })
        .eq("id", existingId);
    } else {
      await s.from("machine_ingredients").insert({
        machine_id: machineId,
        position: mapping.position,
        product_id: match?.id ?? null,
        product_type: mapping.product_type,
        enabled: true,
      });
    }
  }
}
