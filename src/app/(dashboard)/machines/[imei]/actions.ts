"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, editDeviceMedia, listDeviceProducts, pushDeviceSetting, pushProductDiy, refreshProduct, refreshResource, removeDeviceMedia, sendCommand, updateDeviceInfo } from "@/lib/huaxin/client";
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
    const profile = String(fd.get("profile") ?? "");
    const lastClean = String(fd.get("last_full_clean") ?? "");

    // base_product_id is NOT touched here — it's set from the Base hopper
    // card in the product menu section (updateBaseHopper), which is the one
    // place that both pushes to the machine and keeps this field linked.
    const { error: mErr } = await s
      .from("machines")
      .update({
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

/** Unions contains/may_contain allergens across a set of ingredients into one
 * composite image ("contains" always wins over "may_contain" for the same
 * allergen, regardless of which ingredient/row is seen first) and uploads it.
 * Shared by solid-topping cross-contamination and multi-ingredient combos —
 * anywhere multiple ingredients need to present as a single allergen picture.
 * `cacheKey` gives the upload a stable path so repeat pushes overwrite rather
 * than accumulate orphaned files. */
async function computeAllergenCompositeUrl(s: ServiceClient, productIds: string[], cacheKey: string): Promise<string | null> {
  if (!productIds.length) return null;
  const { data: iaRows } = await s
    .from("ingredient_allergens")
    .select("ingredient_id,allergen_id,presence")
    .in("ingredient_id", productIds);
  const { data: allergens } = await s.from("allergens").select("id,logo_url");
  const logoById = new Map(
    ((allergens as { id: string; logo_url: string | null }[]) ?? []).map((a) => [a.id, a.logo_url]),
  );

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
  if (!logos.length) return null;

  const buf = await generateAllergenComposite(logos);
  if (!buf) return null;
  const path = `allergens/${cacheKey}.png`;
  const { error } = await s.storage.from("product-media").upload(path, buf, { contentType: "image/png", upsert: true });
  if (error) return null;
  return s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
}

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

  const compositeUrl = await computeAllergenCompositeUrl(s, productIds, `solids_${machineId}`);

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

/** The Base hopper (lane 1) is the one place base is set — no separate
 * "Base product" dropdown in the config form anymore, since that was a
 * second, divergent path to the same field. Pushes to the machine and, when
 * the picked ingredient came from the catalog (productId set), links
 * machines.base_product_id so combos/lot-tracking can resolve it. Free-typed
 * edits (no catalog pick) push without touching the link, same as any other
 * hopper's manual edit. */
export async function updateBaseHopper(
  imei: string,
  machineId: string | null,
  productId: string | null,
  fields: Record<string, string>,
): Promise<ProductUpdateResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const items: DiyItem[] = Object.entries(fields)
    .filter(([, v]) => v.trim() !== "")
    .map(([code, value]) => ({ position: BASE_LANE, code, value }));
  if (!items.length) return { ok: false, error: "Nothing to update." };

  try {
    const result = await pushProductDiy(cfg, imei, items);
    if (String(result.code) !== "200") {
      return { ok: false, error: result.msg ?? "Update rejected" };
    }
    try { await refreshProduct(cfg, imei); } catch { /* best-effort */ }

    if (isSupabaseConfigured() && machineId && productId) {
      const s = await createServiceClient();
      await s.from("machines").update({ base_product_id: productId }).eq("id", machineId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stages a base edit instead of pushing it live. Still links
 * base_product_id immediately when a catalog ingredient was picked — that's
 * Supabase-only bookkeeping, not a live push, so there's no reason to wait
 * for the draft to actually be sent. */
export async function saveBaseDraft(
  imei: string,
  machineId: string | null,
  productId: string | null,
  fields: Record<string, string>,
): Promise<ProductUpdateResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  if (!machineId) return { ok: false, error: "Machine not synced to Supabase yet — sync first." };
  if (!fields.goodsName && !fields.price && !fields.imagePath && !fields.allergyPath) {
    return { ok: false, error: "Nothing to save." };
  }
  try {
    const s = await createServiceClient();
    await upsertDraftItem(s, machineId, {
      position: BASE_LANE,
      goodsName: fields.goodsName ?? "",
      price: fields.price ?? "",
      imagePath: fields.imagePath ?? "",
      allergyPath: fields.allergyPath || undefined,
    });
    if (productId) {
      await s.from("machines").update({ base_product_id: productId }).eq("id", machineId);
    }
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
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

/** Stages an edit instead of pushing it live — merges into the machine's
 * current pending draft (see upsertDraftItem) so multiple hopper edits can
 * be reviewed and sent together via "Push draft to machine". */
export async function saveHopperDraft(
  imei: string,
  machineId: string | null,
  position: string,
  fields: Record<string, string>,
): Promise<ProductUpdateResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  if (!machineId) return { ok: false, error: "Machine not synced to Supabase yet — sync first." };
  if (!fields.goodsName && !fields.price && !fields.imagePath && !fields.allergyPath) {
    return { ok: false, error: "Nothing to save." };
  }
  try {
    const s = await createServiceClient();
    await upsertDraftItem(s, machineId, {
      position,
      goodsName: fields.goodsName ?? "",
      price: fields.price ?? "",
      imagePath: fields.imagePath ?? "",
      allergyPath: fields.allergyPath || undefined,
    });
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Combos push as a single Huaxin item (goodsName/price/imagePath/allergyPath
 * on one position) — the only item shape confirmed working against the real
 * API. The combined name, summed price default, and cross-ingredient allergen
 * composite are computed here from 2-6 selected ingredients, but this does
 * NOT tell the machine to physically dispense from multiple hopper positions
 * for one order — no confirmed field for that exists yet. If the hardware
 * needs that (plausible given the 59-combination spec), this needs a real
 * Huaxin field name before it can be built. */
export async function pushComboToMachine(
  imei: string,
  position: string,
  ingredientIds: string[],
  price: string,
  imagePath: string,
): Promise<ProductUpdateResult> {
  if (ingredientIds.length < 2 || ingredientIds.length > 6) {
    return { ok: false, error: "Combos need between 2 and 6 ingredients." };
  }
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const resolved = await resolveComboFields(s, imei, position, ingredientIds);
    if ("error" in resolved) return { ok: false, error: resolved.error };

    const items: DiyItem[] = [
      { position, code: "goodsName", value: resolved.goodsName },
      { position, code: "price", value: price },
    ];
    if (imagePath) items.push({ position, code: "imagePath", value: imagePath });
    if (resolved.compositeUrl) items.push({ position, code: "allergyPath", value: resolved.compositeUrl });

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

async function resolveComboFields(
  s: ServiceClient,
  imei: string,
  position: string,
  ingredientIds: string[],
): Promise<{ goodsName: string; compositeUrl: string | null } | { error: string }> {
  const { data: prods } = await s.from("products").select("id,name").in("id", ingredientIds);
  const byId = new Map(((prods as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name]));
  const names = ingredientIds.map((id) => byId.get(id)).filter(Boolean) as string[];
  if (!names.length) return { error: "Ingredients not found." };
  const goodsName = names.join(" + ");
  const compositeUrl = await computeAllergenCompositeUrl(s, ingredientIds, `combo_${imei}_${position}`);
  return { goodsName, compositeUrl };
}

/** Stages a combo instead of pushing it live — same idea as saveHopperDraft,
 * still computes the combined name and cross-ingredient allergen composite
 * (that's Supabase-only bookkeeping, doesn't touch the machine) so the
 * staged draft is fully formed and ready to push later. */
export async function saveComboDraft(
  imei: string,
  machineId: string | null,
  position: string,
  ingredientIds: string[],
  price: string,
  imagePath: string,
): Promise<ProductUpdateResult> {
  if (ingredientIds.length < 2 || ingredientIds.length > 6) {
    return { ok: false, error: "Combos need between 2 and 6 ingredients." };
  }
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  if (!machineId) return { ok: false, error: "Machine not synced to Supabase yet — sync first." };

  try {
    const s = await createServiceClient();
    const resolved = await resolveComboFields(s, imei, position, ingredientIds);
    if ("error" in resolved) return { ok: false, error: resolved.error };

    await upsertDraftItem(s, machineId, {
      position,
      goodsName: resolved.goodsName,
      price,
      imagePath,
      allergyPath: resolved.compositeUrl ?? undefined,
    });
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
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

type DraftItemInput = {
  position: string;
  goodsName: string;
  price: string;
  imagePath: string;
  allergyPath?: string;
};

/** Merges one item into the machine's current pending draft (creating one if
 * none exists), replacing any existing entry for the same position. This is
 * what "Save draft" on an individual hopper/combo/base editor writes to —
 * the same draft a menu copy creates, so edits and copies stack on the same
 * pending set and push together with one "Push draft to machine". */
async function upsertDraftItem(s: ServiceClient, machineId: string, item: DraftItemInput): Promise<void> {
  const { data: existing } = await s
    .from("machine_menu_drafts")
    .select("id,items")
    .eq("machine_id", machineId)
    .is("applied_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const items = ((existing.items as DraftItemInput[]) ?? []).filter((i) => i.position !== item.position);
    items.push(item);
    await s.from("machine_menu_drafts").update({ items }).eq("id", existing.id);
  } else {
    await s.from("machine_menu_drafts").insert({
      machine_id: machineId,
      source_machine_id: null,
      source_machine_name: null,
      items: [item],
    });
  }
}

export type CopyMenuResult = { ok: boolean; error?: string; copiedTo?: number };

/** Snapshots the source machine's live menu (name/price/image — allergyPath
 * isn't exposed by Huaxin's read API, see machine_menu_drafts migration) and
 * queues it as a pending draft on each target machine. Nothing is pushed to
 * any target until they explicitly confirm via pushMenuDraft. */
export async function copyMenuToMachines(_prev: CopyMenuResult | null, fd: FormData): Promise<CopyMenuResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const sourceImei = String(fd.get("source_imei") ?? "");
  const targetIds = fd.getAll("target_machine_id").map(String).filter(Boolean);
  if (!sourceImei) return { ok: false, error: "Missing source machine." };
  if (!targetIds.length) return { ok: false, error: "Select at least one target machine." };

  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };

  try {
    const s = await createServiceClient();
    const { data: source } = await s.from("machines").select("id,name").eq("device_imei", sourceImei).maybeSingle();
    if (!source) return { ok: false, error: "Source machine not found." };

    const { diy, unify } = await listDeviceProducts(cfg, sourceImei);
    const items = [...diy, ...unify]
      .filter((i) => i.position != null)
      .map((i) => ({
        position: String(i.position),
        goodsName: i.goodsName ?? "",
        price: i.price ?? "",
        imagePath: i.imagePath ?? "",
        marketPrice: i.marketPrice ?? "",
      }));
    if (!items.length) return { ok: false, error: "Source machine has no menu to copy." };

    const rows = targetIds.map((machineId) => ({
      machine_id: machineId,
      source_machine_id: source.id,
      source_machine_name: source.name,
      items,
    }));
    const { error } = await s.from("machine_menu_drafts").insert(rows);
    if (error) return { ok: false, error: error.message };

    return { ok: true, copiedTo: targetIds.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pushes every item in a pending draft to the target machine in one batch,
 * then marks the draft applied. This is the "confirm" step — copying never
 * touches the target machine on its own. */
export async function pushMenuDraft(imei: string, draftId: string): Promise<PushResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };

  try {
    const s = await createServiceClient();
    const { data: draft } = await s.from("machine_menu_drafts").select("id,items").eq("id", draftId).maybeSingle();
    if (!draft) return { ok: false, error: "Draft not found." };

    const draftItems = (draft.items as DraftItemInput[]) ?? [];
    const items: DiyItem[] = [];
    for (const it of draftItems) {
      if (it.goodsName) items.push({ position: it.position, code: "goodsName", value: it.goodsName });
      if (it.price) items.push({ position: it.position, code: "price", value: it.price });
      if (it.imagePath) items.push({ position: it.position, code: "imagePath", value: it.imagePath });
      if (it.allergyPath) items.push({ position: it.position, code: "allergyPath", value: it.allergyPath });
    }
    if (!items.length) return { ok: false, error: "Draft has nothing to push." };

    await pushProductDiy(cfg, imei, items);
    try { await refreshProduct(cfg, imei); } catch { /* best-effort */ }

    await s.from("machine_menu_drafts").update({ applied_at: new Date().toISOString() }).eq("id", draftId);
    revalidatePath(`/machines/${imei}`);
    return { ok: true, pushed: draftItems.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dismissMenuDraft(imei: string, draftId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  try {
    const s = await createServiceClient();
    await s.from("machine_menu_drafts").delete().eq("id", draftId);
    revalidatePath(`/machines/${imei}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
