"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, editDeviceMedia, pushDeviceSetting, pushProductDiy, refreshProduct, refreshResource, removeDeviceMedia, sendCommand, updateDeviceInfo } from "@/lib/huaxin/client";
import { generateAllergenComposite } from "@/lib/allergens/composite";

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
        customer_id: String(fd.get("customer_id") ?? "") || null,
        payment_model: String(fd.get("payment_model") ?? "automatic"),
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
// Confirmed layout for the 3+3 config: hopper 1 is always the base (ice cream),
// hoppers 2-4 are solids 1-3, hoppers 5-7 are liquids 1-3.
const LANE_MAP: Record<string, string> = {
  solid_1: "2", solid_2: "3", solid_3: "4",
  liquid_1: "5", liquid_2: "6", liquid_3: "7",
};
const BASE_LANE = "1";
const SOLID_POSITIONS = ["solid_1", "solid_2", "solid_3"];

type DiyItem = { position: string; code: string; value: string };
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** The 3 solid hoppers physically share dispensing hardware, so an allergen in
 * any one of them is a cross-contamination risk in all of them — unlike base/
 * liquids, solids don't get their own individual allergen image, they all get
 * the same composite of every allergen across every solid currently loaded. */
async function buildSolidToppingItems(s: ServiceClient, machineId: string): Promise<{ items: DiyItem[]; count: number }> {
  const { data: ings } = await s
    .from("machine_ingredients")
    .select("position,product_id")
    .eq("machine_id", machineId)
    .in("position", SOLID_POSITIONS);
  const solidIngs = ((ings as { position?: string; product_id?: string }[]) ?? []).filter((i) => i.product_id);
  if (!solidIngs.length) return { items: [], count: 0 };

  const productIds = solidIngs.map((i) => i.product_id!) as string[];
  const { data: prods } = await s.from("products").select("id,name,price,image_url").in("id", productIds);
  const byId = new Map(((prods as Record<string, unknown>[]) ?? []).map((p) => [p.id as string, p]));

  const { data: iaRows } = await s
    .from("ingredient_allergens")
    .select("ingredient_id,allergen_id,presence")
    .in("ingredient_id", productIds);
  const { data: allergens } = await s.from("allergens").select("id,logo_url");
  const logoById = new Map(
    ((allergens as { id: string; logo_url: string | null }[]) ?? []).map((a) => [a.id, a.logo_url]),
  );

  // Any "contains" across the group wins over "may_contain" for that allergen,
  // regardless of which row is seen first.
  const presenceByAllergen = new Map<string, "contains" | "may_contain">();
  for (const row of (iaRows as { allergen_id: string; presence: string }[]) ?? []) {
    const existing = presenceByAllergen.get(row.allergen_id);
    if (existing === "contains") continue;
    if (row.presence === "contains" || existing === undefined) {
      presenceByAllergen.set(row.allergen_id, row.presence as "contains" | "may_contain");
    }
  }
  const logos = [...presenceByAllergen.entries()]
    .map(([allergenId, presence]) => ({ logo_url: logoById.get(allergenId), dim: presence === "may_contain" }))
    .filter((l): l is { logo_url: string; dim: boolean } => !!l.logo_url);

  let compositeUrl: string | null = null;
  if (logos.length) {
    const buf = await generateAllergenComposite(logos);
    if (buf) {
      const path = `allergens/solids_${machineId}.png`;
      const { error } = await s.storage.from("product-media").upload(path, buf, { contentType: "image/png", upsert: true });
      if (!error) compositeUrl = s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    }
  }

  const items: DiyItem[] = [];
  for (const ing of solidIngs) {
    const lane = LANE_MAP[ing.position!];
    const p = byId.get(ing.product_id!) as Record<string, unknown> | undefined;
    if (!lane || !p) continue;
    items.push({ position: lane, code: "goodsName", value: String(p.name ?? "") });
    items.push({ position: lane, code: "price", value: String(p.price ?? 0) });
    if (p.image_url) items.push({ position: lane, code: "imagePath", value: String(p.image_url) });
    if (compositeUrl) items.push({ position: lane, code: "allergyPath", value: compositeUrl });
  }
  return { items, count: solidIngs.length };
}

export async function pushSolidToppings(_prev: PushResult | null, fd: FormData): Promise<PushResult> {
  const imei = String(fd.get("imei") ?? "");
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const { data: m } = await s.from("machines").select("id").eq("device_imei", imei).maybeSingle();
    if (!m?.id) return { ok: false, error: "Machine not in Supabase yet — sync first." };

    const { items, count } = await buildSolidToppingItems(s, m.id as string);
    if (!items.length) return { ok: false, error: "No solid toppings configured. Assign them in the configuration above first." };

    await pushProductDiy(cfg, imei, items);
    try {
      await refreshProduct(cfg, imei);
    } catch {
      /* refresh is best-effort; the update still landed in the cloud */
    }
    return { ok: true, pushed: count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushBaseToMachine(imei: string, productId: string): Promise<ProductUpdateResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  try {
    const s = await createServiceClient();
    const { data: p } = await s.from("products").select("name,price,image_url,allergen_url").eq("id", productId).maybeSingle();
    if (!p) return { ok: false, error: "Base product not found." };
    const items: DiyItem[] = [
      { position: BASE_LANE, code: "goodsName", value: String(p.name ?? "") },
      { position: BASE_LANE, code: "price", value: String(p.price ?? 0) },
    ];
    if (p.image_url) items.push({ position: BASE_LANE, code: "imagePath", value: String(p.image_url) });
    if (p.allergen_url) items.push({ position: BASE_LANE, code: "allergyPath", value: String(p.allergen_url) });

    const result = await pushProductDiy(cfg, imei, items);
    if (String(result.code) === "200") {
      try { await refreshProduct(cfg, imei); } catch { /* best-effort */ }
      return { ok: true };
    }
    return { ok: false, error: result.msg ?? "Update rejected" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushMachineProducts(_prev: PushResult | null, fd: FormData): Promise<PushResult> {
  const imei = String(fd.get("imei") ?? "");
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const { data: m } = await s.from("machines").select("id,base_product_id").eq("device_imei", imei).maybeSingle();
    if (!m?.id) return { ok: false, error: "Machine not in Supabase yet — sync first." };
    const { data: ings } = await s.from("machine_ingredients").select("position,product_id").eq("machine_id", m.id);
    const liquidIngs = ((ings as { position?: string; product_id?: string }[]) ?? []).filter(
      (i) => i.position?.startsWith("liquid_") && i.product_id,
    );

    const liquidProductIds = liquidIngs.map((i) => i.product_id!) as string[];
    const { data: prods } = await s
      .from("products")
      .select("id,name,price,image_url,allergen_url")
      .in("id", m.base_product_id ? [...liquidProductIds, m.base_product_id as string] : liquidProductIds);
    const byId = new Map(((prods as Record<string, unknown>[]) ?? []).map((p) => [p.id as string, p]));

    const items: DiyItem[] = [];
    const pushLane = (lane: string | undefined, p: Record<string, unknown> | undefined) => {
      if (!lane || !p) return;
      items.push({ position: lane, code: "goodsName", value: String(p.name ?? "") });
      items.push({ position: lane, code: "price", value: String(p.price ?? 0) });
      if (p.image_url) items.push({ position: lane, code: "imagePath", value: String(p.image_url) });
      if (p.allergen_url) items.push({ position: lane, code: "allergyPath", value: String(p.allergen_url) });
    };
    for (const ing of liquidIngs) {
      pushLane(LANE_MAP[ing.position!], byId.get(ing.product_id!));
    }
    if (m.base_product_id) pushLane(BASE_LANE, byId.get(m.base_product_id as string));

    const { items: solidItems, count: solidCount } = await buildSolidToppingItems(s, m.id as string);
    items.push(...solidItems);

    if (!items.length) return { ok: false, error: "No hoppers configured. Assign products in the configuration above first." };

    await pushProductDiy(cfg, imei, items);
    try {
      await refreshProduct(cfg, imei);
    } catch {
      /* refresh is best-effort; the update still landed in the cloud */
    }
    return { ok: true, pushed: liquidIngs.length + solidCount + (m.base_product_id ? 1 : 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMachineCommand(
  imei: string,
  command: string,
): Promise<{ ok: boolean; error?: string; huaxinCode?: string; huaxinMsg?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const result = await sendCommand(cfg, imei, command);
    const code = String(result.code);
    const msg = result.msg ?? "";
    if (code === "200") return { ok: true, huaxinCode: code, huaxinMsg: msg || "success" };
    return { ok: false, error: msg || "Command rejected", huaxinCode: code, huaxinMsg: msg };
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

export type ProductUpdateResult = { ok: boolean; error?: string };
export type BrandingResult = { ok: boolean; error?: string };

export async function updateMachineProduct(
  imei: string,
  position: string,
  fields: Record<string, string>,
): Promise<ProductUpdateResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const items = Object.entries(fields)
    .filter(([, v]) => v.trim() !== "")
    .map(([code, value]) => ({ position: String(position), code, value }));
  if (!items.length) return { ok: false, error: "Nothing to update." };
  try {
    const result = await pushProductDiy(cfg, imei, items);
    if (String(result.code) === "200") {
      try { await refreshProduct(cfg, imei); } catch { /* best-effort */ }
      return { ok: true };
    }
    return { ok: false, error: result.msg ?? "Update rejected" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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

export type UploadResult = { ok: boolean; url?: string; error?: string };

export async function uploadMenuItemImage(fd: FormData): Promise<UploadResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const file = fd.get("image");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "No file provided." };

  try {
    const s = await createServiceClient();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `menu-items/${crypto.randomUUID()}.${ext}`;
    const { error } = await s.storage
      .from("product-media")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
    if (error) return { ok: false, error: error.message };
    const url = s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
