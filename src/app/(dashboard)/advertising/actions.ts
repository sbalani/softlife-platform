"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, editDeviceMedia, refreshResource } from "@/lib/huaxin/client";

export type UploadResult = { ok: boolean; error?: string };
export type AssignResult = { ok: boolean; assigned: number; errors: string[] };

export async function uploadMedia(_prev: UploadResult | null, fd: FormData): Promise<UploadResult> {
  const file = fd.get("file");
  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("type") ?? "image");
  const duration = Number(fd.get("duration") ?? 60) || 60;
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `advertising/${crypto.randomUUID()}.${ext}`;
    const { error } = await s.storage
      .from("product-media")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
    if (error) return { ok: false, error: error.message };
    const url = s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    await s.from("media").insert({ url, name: name || file.name, type, duration });
    revalidatePath("/advertising");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function assignToMachines(
  mediaUrl: string,
  mediaType: string,
  duration: number,
  imeis: string[],
): Promise<AssignResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, assigned: 0, errors: ["Huaxin not configured."] };
  let assigned = 0;
  const errors: string[] = [];
  for (const imei of imeis) {
    try {
      await editDeviceMedia(cfg, imei, { res_type: mediaType, res_path: mediaUrl, res_duration: duration });
      try { await refreshResource(cfg, imei); } catch { /* best-effort */ }
      assigned++;
    } catch (e) {
      errors.push(`${imei}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: assigned > 0, assigned, errors };
}
