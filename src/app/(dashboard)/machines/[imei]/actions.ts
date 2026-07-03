"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, editDeviceMedia, pushDeviceSetting, pushProductDiy, refreshProduct, refreshResource, removeDeviceMedia, sendCommand, updateDeviceInfo } from "@/lib/huaxin/client";

export type SaveResult = { ok: boolean; error?: string };
export type PushResult = { ok: boolean; error?: string; pushed?: number };

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

// Convention mapping dashboard hopper slots -> Huaxin lane numbers.
// Confirm/adjust against the actual machine layout when the 3+3 units arrive.
const LANE_MAP: Record<string, string> = {
  solid_1: "1", solid_2: "2", solid_3: "3",
  liquid_1: "4", liquid_2: "5", liquid_3: "6",
};

export async function pushMachineProducts(_prev: PushResult | null, fd: FormData): Promise<PushResult> {
  const imei = String(fd.get("imei") ?? "");
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const { data: m } = await s.from("machines").select("id").eq("device_imei", imei).maybeSingle();
    if (!m?.id) return { ok: false, error: "Machine not in Supabase yet — sync first." };
    const { data: ings } = await s.from("machine_ingredients").select("position,product_id").eq("machine_id", m.id);
    const productIds = ((ings as { product_id?: string }[]) ?? []).map((i) => i.product_id).filter(Boolean) as string[];
    if (!productIds.length) return { ok: false, error: "No hoppers configured. Assign products in the configuration above first." };

    const { data: prods } = await s.from("products").select("id,name,price,image_url,allergen_url").in("id", productIds);
    const byId = new Map(((prods as Record<string, unknown>[]) ?? []).map((p) => [p.id as string, p]));

    const items: { position: string; code: string; value: string }[] = [];
    for (const ing of (ings as { position?: string; product_id?: string }[]) ?? []) {
      const lane = ing.position ? LANE_MAP[ing.position] : undefined;
      const p = ing.product_id ? byId.get(ing.product_id) : undefined;
      if (!lane || !p) continue;
      items.push({ position: lane, code: "goodsName", value: String((p as Record<string, unknown>).name ?? "") });
      items.push({ position: lane, code: "price", value: String((p as Record<string, unknown>).price ?? 0) });
      if ((p as Record<string, unknown>).image_url) items.push({ position: lane, code: "imagePath", value: String((p as Record<string, unknown>).image_url) });
      if ((p as Record<string, unknown>).allergen_url) items.push({ position: lane, code: "allergyPath", value: String((p as Record<string, unknown>).allergen_url) });
    }
    if (!items.length) return { ok: false, error: "Nothing mapped to a lane (check the lane mapping)." };

    await pushProductDiy(cfg, imei, items);
    try {
      await refreshProduct(cfg, imei);
    } catch {
      /* refresh is best-effort; the update still landed in the cloud */
    }
    return { ok: true, pushed: productIds.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMachineCommand(
  imei: string,
  command: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const result = await sendCommand(cfg, imei, command);
    if (String(result.code) === "200") return { ok: true };
    return { ok: false, error: result.msg ?? "Command rejected" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type MediaResult = { ok: boolean; error?: string };

export async function addDeviceMedia(_prev: MediaResult | null, fd: FormData): Promise<MediaResult> {
  const imei = String(fd.get("imei") ?? "");
  const file = fd.get("media");
  const resType = String(fd.get("res_type") ?? "image");
  const duration = Number(fd.get("res_duration") ?? 60) || 60;
  const intro = String(fd.get("res_intro") ?? "");
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `media/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await s.storage
      .from("product-media")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
    if (upErr) return { ok: false, error: upErr.message };
    const resPath = s.storage.from("product-media").getPublicUrl(path).data.publicUrl;

    await editDeviceMedia(cfg, imei, { res_type: resType, res_path: resPath, res_intro: intro, res_duration: duration });
    try { await refreshResource(cfg, imei); } catch { /* best-effort sync */ }
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeDeviceMediaAction(
  imei: string,
  resType: string,
  resCode: string,
): Promise<MediaResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    await removeDeviceMedia(cfg, imei, resType, resCode);
    try { await refreshResource(cfg, imei); } catch { /* best-effort */ }
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BrandingResult = { ok: boolean; error?: string };

export async function updateDeviceBranding(_prev: BrandingResult | null, fd: FormData): Promise<BrandingResult> {
  const imei = String(fd.get("imei") ?? "");
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const fields: Record<string, string>[] = [];
  for (const key of ["deviceLabel", "deviceMerchant", "deviceTel", "language"]) {
    const val = String(fd.get(key) ?? "").trim();
    if (val) fields.push({ [key]: val });
  }
  if (!fields.length) return { ok: false, error: "Nothing to update." };
  try {
    const result = await updateDeviceInfo(cfg, imei, fields);
    if (String(result.code) === "200") return { ok: true };
    return { ok: false, error: result.msg ?? "Update rejected" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushMachineSetting(
  imei: string,
  code: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const result = await pushDeviceSetting(cfg, imei, code, value);
    if (String(result.code) === "200") return { ok: true };
    return { ok: false, error: result.msg ?? "Setting rejected" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
