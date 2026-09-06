import type { SessionProfile } from "@/lib/auth/session";
import { mergeCouponCodeMetadata, validateCouponCodeMetadata, type CouponCodeMetadata } from "@/lib/coupon-code-metadata";
import { getConfigFromEnv, getCouponRecords } from "@/lib/huaxin/client";
import { createServiceClient } from "@/lib/supabase/server";

const COUPON_ID = /^\d+$/;

export async function getCouponCodesWithMetadata(couponId: string) {
  const cfg = getConfigFromEnv();
  if (!cfg) throw new Error("Huaxin not configured.");
  if (!COUPON_ID.test(couponId) || Number(couponId) < 1) throw new Error("Invalid coupon ID.");
  const records = await getCouponRecords(cfg, couponId, "");
  const metadata: CouponCodeMetadata[] = [];
  const s = await createServiceClient();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("coupon_code_metadata")
      .select("huaxin_coupon_id,coupon_code,distributed,extra_information,revision")
      .eq("huaxin_coupon_id", couponId)
      .order("coupon_code")
      .range(offset, offset + 999);
    if (error) throw error;
    metadata.push(...((data as CouponCodeMetadata[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return mergeCouponCodeMetadata(records, metadata);
}

export async function updateCouponCodeMetadata(couponId: string, code: string, distributed: boolean, extraInformation: string, expectedRevision: number | null, actor: Pick<SessionProfile, "id">) {
  if (typeof couponId !== "string" || typeof code !== "string" || typeof extraInformation !== "string" || !COUPON_ID.test(couponId) || Number(couponId) < 1 || typeof distributed !== "boolean"
    || expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) return { ok: false, error: "Invalid coupon distribution update." };
  const normalized = validateCouponCodeMetadata(code, extraInformation);
  if ("error" in normalized) return { ok: false, error: normalized.error };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const records = await getCouponRecords(cfg, couponId, normalized.code);
    const exists = records.some((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).code === normalized.code);
    if (!exists) return { ok: false, error: "Coupon code was not found in this campaign." };
    const s = await createServiceClient();
    const revision = (expectedRevision ?? 0) + 1;
    const values = {
      huaxin_coupon_id: couponId,
      coupon_code: normalized.code,
      distributed,
      extra_information: normalized.extraInformation,
      updated_by: actor.id,
      revision,
      updated_at: new Date().toISOString(),
    };
    if (expectedRevision === null) {
      const { error } = await s.from("coupon_code_metadata").insert(values);
      if (error?.code === "23505") return { ok: false, error: "Distribution information changed elsewhere. Reload the coupon codes and try again." };
      return error ? { ok: false, error: error.message } : { ok: true, revision };
    }
    const { data, error } = await s.from("coupon_code_metadata").update(values)
      .eq("huaxin_coupon_id", couponId).eq("coupon_code", normalized.code).eq("revision", expectedRevision)
      .select("revision").maybeSingle();
    if (error) return { ok: false, error: error.message };
    return data ? { ok: true, revision } : { ok: false, error: "Distribution information changed elsewhere. Reload the coupon codes and try again." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteCouponCodeMetadata(couponId: string) {
  if (!COUPON_ID.test(couponId) || Number(couponId) < 1) return "Invalid coupon ID.";
  try {
    const { error } = await (await createServiceClient()).from("coupon_code_metadata").delete().eq("huaxin_coupon_id", couponId);
    return error?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
